import { MAX_PENDING } from './attribution';
import { normalizeConfig, resolveLearning } from './config';
import { initIntent, withContributions } from './intent';
import { signalWeights } from './learning';
import { canMigrate, migrateStored } from './migrate';
import { requireState } from './state';
import type {
  DeserializeOptions,
  EngineConfig,
  EngineState,
  EpisodeIntentRecord,
  EpisodeState,
  IntentState,
  PendingEpisode,
  SignalContribution,
  SignalRecord,
} from './types';
import { getOwn, hasOwn, isRecord } from './util';
import { STATE_VERSION } from './version';

/**
 * The state as a JSON string, for the host app to persist wherever it likes. The state is plain
 * data, so this is `JSON.stringify` after a shape check. The output never contains event props.
 *
 * @param state - The state to persist.
 * @returns A JSON string that {@link deserialize} restores losslessly.
 * @throws `TypeError` when `state` is not an engine state.
 * @example
 * ```ts
 * localStorage.setItem('oracular', serialize(state));
 * ```
 */
export function serialize(state: EngineState): string {
  return JSON.stringify(requireState(state));
}

/**
 * Restores a state saved with {@link serialize}.
 *
 * Always pass the app's current `config`: it is validated and replaces the stored snapshot,
 * intents and signals no longer declared are dropped (α and β are recomputed from the kept
 * contributions), and newly declared intents start at their prior. States saved by oracular
 * 0.1.0 to 0.5.x are upgraded to the current shape on their own; `migrate` is only for a version
 * this library does not know.
 *
 * @param json - A string produced by {@link serialize}.
 * @param opts - `config`: the app's current config. `migrate`: called as
 *   `migrate(stored, version)` when the stored version is neither {@link STATE_VERSION} nor one
 *   this library migrates itself; it must return a state of the current version.
 * @returns A validated state that satisfies the engine's invariants.
 * @throws `SyntaxError` when `json` is not valid JSON.
 * @throws `TypeError` when the stored data, the result of `migrate`, `opts` or `opts.config`
 *   has the wrong shape.
 * @throws `RangeError` when the stored version is unknown and no `migrate` is given, when
 *   `migrate` does not return the current version, when a stored number is out of range, or
 *   when stored numbers are finite but too large to compute with (a tampered or corrupted state
 *   that would otherwise answer NaN).
 * @example
 * ```ts
 * const saved = localStorage.getItem('oracular');
 * let state = saved ? deserialize(saved, { config }) : createState(config);
 * ```
 */
export function deserialize(json: string, opts: DeserializeOptions = {}): EngineState {
  if (typeof json !== 'string') throw new TypeError('oracular: deserialize expects a JSON string');
  if (!isRecord(opts)) throw new TypeError('oracular: options must be a plain object');
  for (const key of Object.keys(opts)) {
    if (key !== 'config' && key !== 'migrate') {
      throw new TypeError(
        `oracular: options.${key} is not a recognised option (expected one of: config, migrate)`,
      );
    }
  }
  if (opts.migrate !== undefined && typeof opts.migrate !== 'function') {
    throw new TypeError('oracular: options.migrate must be a function');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`oracular: stored state is not valid JSON (${(error as Error).message})`);
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    throw new TypeError('oracular: stored state has no numeric version field');
  }

  let stored: unknown = parsed;
  if (parsed.version !== STATE_VERSION) {
    if (canMigrate(parsed.version)) {
      stored = migrateStored(parsed);
    } else if (opts.migrate === undefined) {
      throw new RangeError(
        `oracular: stored state is version ${parsed.version} but this library reads versions 1 to ${STATE_VERSION}; pass a migrate function`,
      );
    } else {
      stored = opts.migrate(parsed, parsed.version);
    }
  }

  const raw = parseState(stored);
  const config = opts.config === undefined ? raw.config : normalizeConfig(opts.config);
  return requireComputable(reconcile(raw, config));
}

// ---- parsing: field types only; keys are reconciled against the config afterwards ----

function typeError(path: string, message: string): never {
  throw new TypeError(`oracular: ${path} ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) typeError(path, 'must be a plain object');
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    typeError(path, 'must be a finite number');
  return value;
}

function nonNegative(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n < 0) throw new RangeError(`oracular: ${path} must be 0 or greater`);
  return n;
}

function nullOrFinite(value: unknown, path: string): number | null {
  return value === null ? null : finite(value, path);
}

function signalRecord(value: unknown, path: string): SignalRecord {
  const r = record(value, path);
  return {
    hits: nonNegative(r.hits, `${path}.hits`),
    misses: nonNegative(r.misses, `${path}.misses`),
  };
}

function contribution(value: unknown, path: string): SignalContribution {
  const r = record(value, path);
  return {
    alpha: nonNegative(r.alpha, `${path}.alpha`),
    beta: nonNegative(r.beta, `${path}.beta`),
  };
}

function mapOwn<T>(
  value: unknown,
  path: string,
  fn: (item: unknown, itemPath: string) => T,
): Record<string, T> {
  const r = record(value, path);
  const out: Record<string, T> = {};
  for (const key of Object.keys(r)) {
    if (key === '__proto__') continue;
    out[key] = fn(r[key], `${path}[${JSON.stringify(key)}]`);
  }
  return out;
}

function pendingEpisodes(value: unknown, path: string): PendingEpisode[] {
  if (!Array.isArray(value)) typeError(path, 'must be an array');
  if (value.length > MAX_PENDING) {
    throw new RangeError(`oracular: ${path} must hold at most ${MAX_PENDING} episodes`);
  }
  return value.map((item, i) => {
    const r = record(item, `${path}[${i}]`);
    if (!Array.isArray(r.seen) || !r.seen.every((s) => typeof s === 'string')) {
      typeError(`${path}[${i}].seen`, 'must be an array of strings');
    }
    return { endedAt: finite(r.endedAt, `${path}[${i}].endedAt`), seen: r.seen as string[] };
  });
}

function intentState(value: unknown, path: string): IntentState {
  const r = record(value, path);
  const revealCount = finite(r.revealCount, `${path}.revealCount`);
  if (!Number.isInteger(revealCount) || revealCount < 0) {
    throw new RangeError(`oracular: ${path}.revealCount must be a non-negative integer`);
  }
  return {
    alpha: finite(r.alpha, `${path}.alpha`),
    beta: finite(r.beta, `${path}.beta`),
    updatedAt: nullOrFinite(r.updatedAt, `${path}.updatedAt`),
    contributions: mapOwn(r.contributions, `${path}.contributions`, contribution),
    learned: mapOwn(r.learned, `${path}.learned`, signalRecord),
    episodes: signalRecord(r.episodes, `${path}.episodes`),
    pending: pendingEpisodes(r.pending, `${path}.pending`),
    learnedAt: nullOrFinite(r.learnedAt, `${path}.learnedAt`),
    lastRevealedAt: nullOrFinite(r.lastRevealedAt, `${path}.lastRevealedAt`),
    lastOutcomeAt: nullOrFinite(r.lastOutcomeAt, `${path}.lastOutcomeAt`),
    revealCount,
  };
}

function occurrenceCount(value: unknown, path: string): number {
  const n = finite(value, path);
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`oracular: ${path} must be a positive integer`);
  }
  return n;
}

function episodeIntent(value: unknown, path: string): EpisodeIntentRecord {
  const r = record(value, path);
  if (!Array.isArray(r.seen) || !r.seen.every((s) => typeof s === 'string')) {
    typeError(`${path}.seen`, 'must be an array of strings');
  }
  const counts = mapOwn(r.counts, `${path}.counts`, occurrenceCount);
  if (typeof r.resolved !== 'boolean') typeError(`${path}.resolved`, 'must be a boolean');
  return { seen: r.seen as string[], counts, resolved: r.resolved };
}

function episodeState(value: unknown, path: string): EpisodeState {
  const r = record(value, path);
  return {
    startedAt: nullOrFinite(r.startedAt, `${path}.startedAt`),
    lastEventAt: nullOrFinite(r.lastEventAt, `${path}.lastEventAt`),
    intents: mapOwn(r.intents, `${path}.intents`, episodeIntent),
  };
}

function parseState(value: unknown): EngineState {
  const r = record(value, 'state');
  if (r.version !== STATE_VERSION) {
    throw new RangeError(`oracular: state.version must be ${STATE_VERSION} after migration`);
  }
  return {
    version: STATE_VERSION,
    config: normalizeConfig(r.config),
    intents: mapOwn(r.intents, 'state.intents', intentState),
    episode: episodeState(r.episode, 'state.episode'),
  };
}

// ---- computability: finite numbers that are still too large to compute with ----

/**
 * Every stored number is checked to be finite, but finite is not enough: a contribution near
 * 1e308 makes α·β overflow, and learned counts near 1e308 make the contrast weighting overflow,
 * so the state would answer NaN. Such a state was tampered with or corrupted; reject it.
 */
function requireComputable(state: EngineState): EngineState {
  const learning = resolveLearning(state.config);
  for (const [name, intent] of Object.entries(state.config.intents)) {
    const is = state.intents[name] as IntentState;
    const path = `state.intents[${JSON.stringify(name)}]`;
    if (!Number.isFinite(is.alpha + is.beta) || !Number.isFinite(is.alpha * is.beta)) {
      throw new RangeError(`oracular: ${path} holds more evidence than can be computed with`);
    }
    for (const signal of Object.keys(intent.signals)) {
      const w = signalWeights(is, intent, learning, signal);
      if (!Number.isFinite(w.learned) || !Number.isFinite(w.effective)) {
        throw new RangeError(
          `oracular: ${path} holds learned counts for ${JSON.stringify(signal)} too large to compute with`,
        );
      }
    }
  }
  return state;
}

// ---- reconciling: make the state agree with a config ----

function keep<T>(source: Record<string, T>, declared: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(source)) {
    if (hasOwn(declared, key)) out[key] = value;
  }
  return out;
}

/** Waiting episodes with their seen lists pruned to declared signals, each once, in order of close. */
function keepPending(
  pending: readonly PendingEpisode[],
  signals: Record<string, number>,
): PendingEpisode[] {
  return pending
    .map((episode) => ({
      endedAt: episode.endedAt,
      seen: episode.seen.filter((s, i) => hasOwn(signals, s) && episode.seen.indexOf(s) === i),
    }))
    .sort((a, b) => a.endedAt - b.endedAt);
}

/**
 * Drops intents and signals the config no longer declares, starts newly declared intents at
 * their prior, and recomputes α and β as the (possibly new) prior plus the kept contributions.
 */
function reconcile(raw: EngineState, config: EngineConfig): EngineState {
  const intents: Record<string, IntentState> = {};
  const episodeIntents: Record<string, EpisodeIntentRecord> = {};

  for (const [name, intent] of Object.entries(config.intents)) {
    const stored = getOwn(raw.intents, name);
    if (stored === undefined) {
      intents[name] = initIntent(intent);
    } else {
      intents[name] = withContributions(
        {
          ...stored,
          learned: keep(stored.learned, intent.signals),
          pending: keepPending(stored.pending, intent.signals),
        },
        intent,
        keep(stored.contributions, intent.signals),
      );
    }
    const episode = getOwn(raw.episode.intents, name);
    if (episode !== undefined && raw.episode.startedAt !== null) {
      const seen = episode.seen.filter(
        (s, i) => hasOwn(intent.signals, s) && episode.seen.indexOf(s) === i,
      );
      // One count per seen signal and no other: a seen signal without one counts once.
      const counts: Record<string, number> = {};
      for (const s of seen) counts[s] = getOwn(episode.counts, s) ?? 1;
      episodeIntents[name] = { seen, counts, resolved: episode.resolved };
    }
  }

  return {
    version: STATE_VERSION,
    config,
    intents,
    episode: {
      startedAt: raw.episode.startedAt,
      lastEventAt: raw.episode.startedAt === null ? null : raw.episode.lastEventAt,
      intents: episodeIntents,
    },
  };
}
