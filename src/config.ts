import type {
  EngineConfig,
  EvaluateOptions,
  ExplainOptions,
  IntentConfig,
  LearningConfig,
  LiftType,
  RevealOptions,
} from './types';
import { hasOwn, isRecord } from './util';

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_Z = 1.28;
export const DEFAULT_GAIN = 2;
export const DEFAULT_PRIOR_EPISODES = 10;
/**
 * Largest accepted magnitude for weights, `priorStrength`, `learning.gain` and
 * `learning.priorEpisodes`: far beyond any real config, and small enough that the Beta and
 * learning arithmetic can never overflow to Infinity or NaN.
 */
export const MAX_MAGNITUDE = 1e6;
/** Largest accepted `z`: 3.09 is already a one-sided 99.9% bound, and 128 is a misplaced 1.28. */
export const MAX_Z = 10;

// Exported for tests/schema.test.ts, which pins schema/config.schema.json to these lists.
export const CONFIG_KEYS = ['intents', 'episodeTimeout', 'learning', 'reveal'] as const;
export const INTENT_KEYS = [
  'prior',
  'priorStrength',
  'halfLife',
  'signals',
  'outcome',
  'resetOnOutcome',
  'saturate',
  'attribution',
  'reveal',
] as const;
export const REVEAL_KEYS = ['threshold', 'z', 'cooldown', 'bound'] as const;
export const LEARNING_KEYS = ['halfLife', 'gain', 'priorEpisodes', 'lift'] as const;
export const LIFT_TYPES: readonly LiftType[] = [
  'absolute-difference',
  'relative-lift',
  'risk-ratio',
  'log-lift',
  'odds-ratio',
  'normalized-difference',
  'association-rule',
];
const EXPLAIN_KEYS = ['nonZero', 'limit'] as const;

function typeError(path: string, message: string): never {
  throw new TypeError(`oracular: ${path} ${message}`);
}

function rangeError(path: string, message: string): never {
  throw new RangeError(`oracular: ${path} ${message}`);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) typeError(path, 'must be a plain object');
  return value;
}

function expectKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      typeError(
        `${path}.${key}`,
        `is not a recognised option (expected one of: ${allowed.join(', ')})`,
      );
    }
  }
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    typeError(path, 'must be a finite number');
  return value;
}

function expectPositive(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n <= 0) rangeError(path, 'must be greater than 0');
  return n;
}

/** A positive number no larger than {@link MAX_MAGNITUDE}. */
function expectBoundedPositive(value: unknown, path: string): number {
  const n = expectPositive(value, path);
  if (n > MAX_MAGNITUDE) rangeError(path, `must be at most ${MAX_MAGNITUDE}`);
  return n;
}

function expectNonNegative(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0) rangeError(path, 'must be 0 or greater');
  return n;
}

function expectOpenUnit(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n <= 0 || n >= 1) rangeError(path, 'must be strictly between 0 and 1');
  return n;
}

function expectClosedUnit(value: unknown, path: string): number {
  const n = expectNumber(value, path);
  if (n < 0 || n > 1) rangeError(path, 'must be between 0 and 1');
  return n;
}

export function expectName(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0)
    typeError(path, 'must be a non-empty string');
  return value;
}

/** Keys of user-named records must be usable as own properties of a plain object. */
function expectKeyName(name: string, path: string): string {
  if (name.length === 0) typeError(path, 'names must be non-empty strings');
  if (name === '__proto__') typeError(path, 'must not use the reserved name "__proto__"');
  return name;
}

/**
 * Validates reveal options and returns a copy with only the defined keys. `strict` adds the checks
 * that catch a config that cannot work (a threshold of 0 or 1, a `z` past {@link MAX_Z}); a
 * stored config is read without them, so a state saved before those checks existed still loads.
 */
export function normalizeRevealOptions(value: unknown, path: string, strict = true): RevealOptions {
  const record = expectRecord(value, path);
  expectKeys(record, REVEAL_KEYS, path);
  const out: RevealOptions = {};
  if (record.threshold !== undefined) {
    out.threshold = strict
      ? expectOpenUnit(record.threshold, `${path}.threshold`)
      : expectClosedUnit(record.threshold, `${path}.threshold`);
  }
  if (record.z !== undefined) {
    out.z = expectNonNegative(record.z, `${path}.z`);
    if (strict && out.z > MAX_Z) rangeError(`${path}.z`, `must be at most ${MAX_Z}`);
  }
  if (record.cooldown !== undefined) {
    out.cooldown = expectNonNegative(record.cooldown, `${path}.cooldown`);
  }
  if (record.bound !== undefined) {
    if (record.bound !== 'normal' && record.bound !== 'exact') {
      typeError(`${path}.bound`, 'must be "normal" or "exact"');
    }
    out.bound = record.bound;
  }
  return out;
}

function normalizeLearning(value: unknown, path: string): LearningConfig {
  const record = expectRecord(value, path);
  expectKeys(record, LEARNING_KEYS, path);
  const out: LearningConfig = {};
  if (record.lift !== undefined) {
    if (!LIFT_TYPES.includes(record.lift as LiftType)) {
      typeError(`${path}.lift`, `must be one of: ${LIFT_TYPES.join(', ')}`);
    }
    out.lift = record.lift as LiftType;
  }
  if (record.halfLife !== undefined)
    out.halfLife = expectPositive(record.halfLife, `${path}.halfLife`);
  if (record.gain !== undefined) out.gain = expectBoundedPositive(record.gain, `${path}.gain`);
  if (record.priorEpisodes !== undefined) {
    out.priorEpisodes = expectBoundedPositive(record.priorEpisodes, `${path}.priorEpisodes`);
  }
  return out;
}

/**
 * Validates one intent's config and returns a copy with only the defined, recognised keys. See
 * {@link normalizeRevealOptions} for `strict`: here it also rejects an outcome that is one of the
 * intent's own signals while `resetOnOutcome` is on.
 */
export function normalizeIntentConfig(value: unknown, path: string, strict = true): IntentConfig {
  const record = expectRecord(value, path);
  expectKeys(record, INTENT_KEYS, path);
  const signalsRecord = expectRecord(record.signals, `${path}.signals`);
  const signals: Record<string, number> = {};
  for (const [name, weight] of Object.entries(signalsRecord)) {
    expectKeyName(name, `${path}.signals`);
    const w = expectNumber(weight, `${path}.signals[${JSON.stringify(name)}]`);
    if (w === 0) {
      rangeError(
        `${path}.signals[${JSON.stringify(name)}]`,
        'must be non-zero (positive is evidence for the intent, negative is evidence against)',
      );
    }
    if (Math.abs(w) > MAX_MAGNITUDE) {
      rangeError(
        `${path}.signals[${JSON.stringify(name)}]`,
        `must be between -${MAX_MAGNITUDE} and ${MAX_MAGNITUDE}`,
      );
    }
    signals[name] = w;
  }
  const out: IntentConfig = {
    prior: expectOpenUnit(record.prior, `${path}.prior`),
    priorStrength: expectBoundedPositive(record.priorStrength, `${path}.priorStrength`),
    halfLife: expectPositive(record.halfLife, `${path}.halfLife`),
    signals,
  };
  if (record.outcome !== undefined) out.outcome = expectName(record.outcome, `${path}.outcome`);
  if (record.resetOnOutcome !== undefined) {
    if (typeof record.resetOnOutcome !== 'boolean') {
      typeError(`${path}.resetOnOutcome`, 'must be a boolean');
    }
    out.resetOnOutcome = record.resetOnOutcome;
  }
  if (record.saturate !== undefined) {
    if (typeof record.saturate !== 'boolean') typeError(`${path}.saturate`, 'must be a boolean');
    out.saturate = record.saturate;
  }
  if (record.attribution !== undefined) {
    out.attribution = expectPositive(record.attribution, `${path}.attribution`);
  }
  if (record.reveal !== undefined) {
    out.reveal = normalizeRevealOptions(record.reveal, `${path}.reveal`, strict);
  }
  if (
    strict &&
    out.outcome !== undefined &&
    hasOwn(signals, out.outcome) &&
    out.resetOnOutcome !== false
  ) {
    typeError(
      `${path}.outcome`,
      'is also one of its signals: the reset on outcome would wipe what it adds; set resetOnOutcome: false to keep it',
    );
  }
  return out;
}

/**
 * Validates a config and returns a fresh copy holding only the defined, recognised keys,
 * so that it survives a JSON round trip unchanged. `strict` (the default) adds the checks that
 * catch a config that cannot work; `deserialize` reads a stored config without them.
 */
export function normalizeConfig(value: unknown, strict = true): EngineConfig {
  const record = expectRecord(value, 'config');
  expectKeys(record, CONFIG_KEYS, 'config');
  const intentsRecord = expectRecord(record.intents, 'config.intents');
  const names = Object.keys(intentsRecord);
  if (names.length === 0) typeError('config.intents', 'must declare at least one intent');
  const intents: Record<string, IntentConfig> = {};
  for (const name of names) {
    expectKeyName(name, 'config.intents');
    intents[name] = normalizeIntentConfig(
      intentsRecord[name],
      `config.intents[${JSON.stringify(name)}]`,
      strict,
    );
  }
  const out: EngineConfig = { intents };
  if (record.episodeTimeout !== undefined) {
    out.episodeTimeout = expectPositive(record.episodeTimeout, 'config.episodeTimeout');
  }
  if (record.learning !== undefined)
    out.learning = normalizeLearning(record.learning, 'config.learning');
  if (record.reveal !== undefined) {
    out.reveal = normalizeRevealOptions(record.reveal, 'config.reveal', strict);
  }
  return out;
}

/** Validates explain filters and returns a copy with only the defined keys. */
export function normalizeExplainOptions(value: unknown, path: string): ExplainOptions {
  const record = expectRecord(value, path);
  expectKeys(record, EXPLAIN_KEYS, path);
  const out: ExplainOptions = {};
  if (record.nonZero !== undefined) {
    if (typeof record.nonZero !== 'boolean') typeError(`${path}.nonZero`, 'must be a boolean');
    out.nonZero = record.nonZero;
  }
  if (record.limit !== undefined) {
    const n = expectNumber(record.limit, `${path}.limit`);
    if (!Number.isInteger(n) || n < 0)
      rangeError(`${path}.limit`, 'must be a non-negative integer');
    out.limit = n;
  }
  return out;
}

/** Splits `evaluate` options into reveal overrides and explain filters, rejecting unknown keys. */
export function splitEvaluateOptions(
  value: EvaluateOptions | undefined,
  path: string,
): { reveal: RevealOptions; explain: ExplainOptions } {
  if (value === undefined) return { reveal: {}, explain: {} };
  const record = expectRecord(value, path);
  expectKeys(record, [...REVEAL_KEYS, ...EXPLAIN_KEYS], path);
  const reveal: Record<string, unknown> = {};
  const explain: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(record)) {
    if ((REVEAL_KEYS as readonly string[]).includes(key)) reveal[key] = v;
    else explain[key] = v;
  }
  return {
    reveal: normalizeRevealOptions(reveal, path, false),
    explain: normalizeExplainOptions(explain, path),
  };
}

export interface ResolvedReveal {
  threshold: number;
  z: number;
  cooldown: number;
  bound: 'normal' | 'exact';
}

export function resolveReveal(
  config: EngineConfig | undefined,
  intent: IntentConfig,
  opts: RevealOptions | undefined,
  normalized = false,
): ResolvedReveal {
  // Per-call options are read without the strict checks: a probe at threshold 0 or 1 is a
  // legitimate question (evidenceToReveal asks it); a config that commits to one is not.
  const o =
    opts === undefined ? {} : normalized ? opts : normalizeRevealOptions(opts, 'options', false);
  return {
    threshold:
      o.threshold ?? intent.reveal?.threshold ?? config?.reveal?.threshold ?? DEFAULT_THRESHOLD,
    z: o.z ?? intent.reveal?.z ?? config?.reveal?.z ?? DEFAULT_Z,
    cooldown: o.cooldown ?? intent.reveal?.cooldown ?? config?.reveal?.cooldown ?? intent.halfLife,
    bound: o.bound ?? intent.reveal?.bound ?? config?.reveal?.bound ?? 'normal',
  };
}

export interface ResolvedLearning {
  lift: LiftType;
  /** null means learned counts never decay. */
  halfLife: number | null;
  gain: number;
  priorEpisodes: number;
}

export function resolveLearning(config: EngineConfig): ResolvedLearning {
  return {
    lift: config.learning?.lift ?? 'normalized-difference',
    halfLife: config.learning?.halfLife ?? null,
    gain: config.learning?.gain ?? DEFAULT_GAIN,
    priorEpisodes: config.learning?.priorEpisodes ?? DEFAULT_PRIOR_EPISODES,
  };
}

export function expectTimestamp(value: unknown, path: string): number {
  return expectNumber(value, path);
}

export function validateEvent(event: unknown): { name: string; at: number } {
  if (!isRecord(event)) typeError('event', 'must be an object like { name, at }');
  const name = expectName(event.name, 'event.name');
  const at = expectTimestamp(event.at, 'event.at');
  if (event.props !== undefined && !isRecord(event.props)) {
    typeError('event.props', 'must be a plain object when present');
  }
  return { name, at };
}
