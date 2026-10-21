import { assessIntent, buildExplanation, buildPrediction, decideReveal } from './assess';
import {
  expectName,
  expectTimestamp,
  resolveLearning,
  resolveReveal,
  validateEvent,
} from './config';
import { requireState } from './state';
import type {
  EndRecord,
  EngineState,
  EventRecord,
  IntentEvent,
  RecordedDecision,
  RecordMode,
  RecordOptions,
} from './types';
import { getOwn, isRecord } from './util';
import { RECORD_VERSION } from './version';

const RECORD_KEYS = ['installId', 'mode', 'top'];
const DEFAULT_TOP = 3;

function normalizeRecordOptions(value: unknown): Required<RecordOptions> {
  if (!isRecord(value)) {
    throw new TypeError('oracular: options must be an object like { installId, mode }');
  }
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.includes(key)) {
      throw new TypeError(
        `oracular: options.${key} is not a recognised option (expected one of: ${RECORD_KEYS.join(', ')})`,
      );
    }
  }
  const installId = expectName(value.installId, 'options.installId');
  const mode = value.mode;
  if (mode !== 'shadow' && mode !== 'live') {
    throw new TypeError('oracular: options.mode must be "shadow" or "live"');
  }
  let top = DEFAULT_TOP;
  if (value.top !== undefined) {
    if (typeof value.top !== 'number' || !Number.isFinite(value.top)) {
      throw new TypeError('oracular: options.top must be a finite number');
    }
    if (!Number.isInteger(value.top) || value.top < 0) {
      throw new RangeError('oracular: options.top must be a non-negative integer');
    }
    top = value.top;
  }
  return { installId, mode: mode as RecordMode, top };
}

/**
 * A recorder record for an event: the event itself and, for every intent, what the engine decides
 * right after it. Call it with the state `observe` returned for that event, then append
 * `JSON.stringify(record)` as one line of the log (NDJSON). The record holds the event's `name` and
 * `at`, never its `props`.
 *
 * Each decision is what {@link evaluate} reports at `event.at` with the state's own reveal
 * options: `p`, `lower`, `shouldReveal`, `suppressedUntil`, the signals with the largest impact,
 * and the effective weight of every signal. Pure: the install id comes from the app, never from
 * here. See the Shadow mode guide for the whole workflow.
 *
 * On the record of an intent's own outcome event, `p` is what the engine decides right after it,
 * which with `resetOnOutcome` is the prior: the estimate the outcome confirmed is gone. Pass the
 * state from before the event as `previous` and that intent's decision gains `before`, its `p`
 * and `lower` at `event.at` on that state. Replay never reads it; people reading the log do.
 *
 * @param state - The state after `observe(state, event)`. Not mutated.
 * @param event - The event just observed. Only `name` and `at` are recorded.
 * @param opts - `installId` (generated and stored by the app), `mode` (`'shadow'` while
 *   reveals are computed but not shown, `'live'` once they are), and `top` (default 3).
 * @param previous - The state before `observe(state, event)`, optional. Only read for the
 *   intents whose outcome the event is.
 * @returns A plain, JSON-serializable {@link EventRecord}.
 * @throws `TypeError` when `state` or `previous` is not an engine state, the event is
 *   malformed, `opts` is not an object, has an unknown key, an empty `installId` or a `mode`
 *   other than `'shadow'` or `'live'`.
 * @throws `RangeError` when `opts.top` is negative or fractional.
 * @example
 * ```ts
 * const recording = { installId: localStorage.getItem('oracular.install')!, mode: 'shadow' } as const;
 *
 * const event = { name: 'pricing.viewed', at: Date.now() };
 * const previous = state;
 * state = observe(state, event);
 * appendLine(JSON.stringify(createRecord(state, event, recording, previous)));
 * ```
 */
export function createRecord(
  state: EngineState,
  event: IntentEvent,
  opts: RecordOptions,
  previous?: EngineState,
): EventRecord {
  const s = requireState(state);
  const { name, at } = validateEvent(event);
  const { installId, mode, top } = normalizeRecordOptions(opts);
  const prev = previous === undefined ? undefined : requireState(previous);
  const learning = resolveLearning(s.config);
  const decisions: Record<string, RecordedDecision> = {};
  for (const [intentName, intent] of Object.entries(s.config.intents)) {
    const reveal = resolveReveal(s.config, intent, undefined);
    const is = assessIntent(s, intentName, intent, learning, at);
    const prediction = buildPrediction(is, intentName, reveal, at);
    const rows = buildExplanation(is, intent, learning, {});
    const weights: Record<string, number> = {};
    for (const signal of Object.keys(intent.signals)) {
      weights[signal] = (
        rows.find((row) => row.signal === signal) as { effectiveWeight: number }
      ).effectiveWeight;
    }
    const decision: RecordedDecision = {
      p: prediction.p,
      lower: prediction.lower,
      shouldReveal: decideReveal(prediction, reveal),
      suppressedUntil: prediction.suppressedUntil,
      top: rows
        .filter((row) => row.contribution !== 0)
        .slice(0, top)
        .map((row) => ({ signal: row.signal, impact: row.impact })),
      weights,
    };
    // The outcome's record: the estimate just before it, which the reset wipes, when the state
    // before the event was given and still declared the intent.
    const prevIntent = prev === undefined ? undefined : getOwn(prev.config.intents, intentName);
    if (prev !== undefined && prevIntent !== undefined && intent.outcome === name) {
      const was = buildPrediction(
        assessIntent(prev, intentName, prevIntent, resolveLearning(prev.config), at),
        intentName,
        resolveReveal(prev.config, prevIntent, undefined),
        at,
      );
      decision.before = { p: was.p, lower: was.lower };
    }
    decisions[intentName] = decision;
  }
  return { v: RECORD_VERSION, kind: 'event', installId, mode, event: { name, at }, decisions };
}

/**
 * A recorder record for the end of an episode. Write one whenever the app calls
 * {@link endEpisode}, with the same `at`, so that replay can end the episode at the same moment
 * and reproduce the misses it records. Episodes that close through `episodeTimeout` need none:
 * replay applies the timeout itself.
 *
 * @param at - The time passed to `endEpisode`.
 * @param opts - The same options as for {@link createRecord}; `top` is accepted and ignored.
 * @returns A plain, JSON-serializable {@link EndRecord}.
 * @throws `TypeError` when `at` is not a finite number or `opts` is malformed.
 * @throws `RangeError` when `opts.top` is negative or fractional.
 * @example
 * ```ts
 * const at = Date.now();
 * state = endEpisode(state, at);
 * appendLine(JSON.stringify(createEndRecord(at, recording)));
 * ```
 */
export function createEndRecord(at: number, opts: RecordOptions): EndRecord {
  const t = expectTimestamp(at, 'at');
  const { installId, mode } = normalizeRecordOptions(opts);
  return { v: RECORD_VERSION, kind: 'end', installId, mode, at: t };
}
