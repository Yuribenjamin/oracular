import { assessIntent, buildExplanation, buildPrediction, decideReveal } from './assess';
import {
  expectName,
  expectTimestamp,
  resolveLearning,
  resolveReveal,
  splitEvaluateOptions,
} from './config';
import { requireIntentConfig, requireState } from './state';
import type { EngineState, EvaluateOptions, Evaluation, Snapshot } from './types';

/**
 * {@link predict}, {@link shouldReveal} and {@link explain} in one call, from a single decay
 * pass over the intent. The three results are identical to what the separate functions return
 * for the same inputs; this is the one to call on every event when you need all of them.
 * Read-only.
 *
 * @param state - The current state. Not mutated.
 * @param intent - Name of an intent declared in the config.
 * @param at - The time to evaluate at.
 * @param opts - Reveal overrides (`threshold`, `z`, `cooldown`) and explain filters (`nonZero`,
 *   `limit`) in one object.
 * @returns `prediction` (as `predict`), `reveal` (as `shouldReveal`) and `explanation` (as
 *   `explain` with the same filters).
 * @throws `RangeError` when `intent` is not declared in the config.
 * @throws `TypeError` when `state` is not an engine state, `at` is not finite, or `opts` is
 *   malformed.
 * @example
 * ```ts
 * const { prediction, reveal, explanation } = evaluate(state, 'upgrade', Date.now(), { limit: 3 });
 * if (reveal) showOffer(explanation[0]?.signal);
 * ```
 */
export function evaluate(
  state: EngineState,
  intent: string,
  at: number,
  opts?: EvaluateOptions,
): Evaluation {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const split = splitEvaluateOptions(opts, 'options');
  const reveal = resolveReveal(s.config, config, split.reveal, true);
  const learning = resolveLearning(s.config);
  const is = assessIntent(s, name, config, learning, t);
  const prediction = buildPrediction(is, name, reveal, t);
  return {
    prediction,
    reveal: decideReveal(prediction, reveal),
    explanation: buildExplanation(is, config, learning, split.explain),
  };
}

/**
 * {@link evaluate} for every declared intent at once, in config order: the whole engine's view at
 * one moment, as plain data. This is what to log, assert on, or hand to `renderInspector` from
 * `oracular/inspect` for a live panel. Read-only.
 *
 * @param state - The current state. Not mutated.
 * @param at - The time to evaluate at.
 * @param opts - Reveal overrides and explain filters, applied to every intent.
 * @returns `at` and one {@link IntentSnapshot} per intent.
 * @throws `TypeError` when `state` is not an engine state, `at` is not finite, or `opts` is
 *   malformed.
 * @example
 * ```ts
 * for (const { intent, prediction, reveal } of inspect(state, Date.now()).intents) {
 *   console.log(intent, prediction.p.toFixed(3), reveal ? 'reveal' : '');
 * }
 * ```
 */
export function inspect(state: EngineState, at: number, opts?: EvaluateOptions): Snapshot {
  const s = requireState(state);
  const intents = Object.keys(s.config.intents).map((intent) => ({
    intent,
    ...evaluate(s, intent, at, opts),
  }));
  return { at, intents };
}
