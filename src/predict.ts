import { buildPrediction, decideReveal } from './assess';
import { expectName, expectTimestamp, resolveReveal } from './config';
import { decayIntent } from './intent';
import { getIntentState, requireIntentConfig, requireState } from './state';
import type { EngineState, Prediction, RevealOptions } from './types';

/**
 * The intent's current estimate at time `at`: the Beta mean p, its standard deviation, the
 * lower confidence bound that {@link shouldReveal} tests, and the cooldown status. Read-only:
 * the stored state is decayed to `at` for the reading but not changed.
 *
 * @param state - The current state. Not mutated.
 * @param intent - Name of an intent declared in the config.
 * @param at - The time to evaluate at, in the same unit as your durations.
 * @param opts - Overrides for `threshold`, `z`, `cooldown` and `bound`, resolved as call →
 *   intent → engine → defaults. `z` and `bound` set `lower`; `cooldown` sets `revealed` and
 *   `suppressedUntil`; `threshold` only matters to {@link shouldReveal}.
 * @returns The prediction. `p`, `sd`, `lower` and `confidence` are in [0, 1]; `evidence` is
 *   α + β.
 * @throws `RangeError` when `intent` is not declared in the config.
 * @throws `TypeError` when `state` is not an engine state, `at` is not finite, or `opts` is
 *   malformed.
 * @example
 * ```ts
 * const { p, lower, suppressedUntil } = predict(state, 'upgrade', Date.now());
 * if (suppressedUntil !== null) scheduleNextCheck(suppressedUntil);
 * ```
 */
export function predict(
  state: EngineState,
  intent: string,
  at: number,
  opts?: RevealOptions,
): Prediction {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const reveal = resolveReveal(s.config, config, opts);
  const is = decayIntent(getIntentState(s, name, config), config, t);
  return buildPrediction(is, name, reveal, t);
}

/**
 * Whether to act on the intent now. True when p ≥ `threshold`, the lower confidence bound
 * (p − z·sd, or the exact Beta quantile with `bound: 'exact'`) also clears `threshold`, and no
 * cooldown is running: neither the one started by
 * {@link markRevealed} nor the one started by the intent's outcome event.
 *
 * @param state - The current state. Not mutated.
 * @param intent - Name of an intent declared in the config.
 * @param at - The time to evaluate at.
 * @param opts - Overrides for `threshold` (default 0.5), `z` (default 1.28, a one-sided 90%
 *   bound) and `cooldown` (default: the intent's `halfLife`).
 * @returns True when the app should show, offer or reveal whatever this intent gates.
 * @throws `RangeError` when `intent` is not declared in the config.
 * @throws `TypeError` when `state` is not an engine state, `at` is not finite, or `opts` is
 *   malformed.
 * @example
 * ```ts
 * if (shouldReveal(state, 'upgrade', Date.now())) {
 *   showUpgradeOffer();
 *   state = markRevealed(state, 'upgrade', Date.now());
 * }
 * ```
 */
export function shouldReveal(
  state: EngineState,
  intent: string,
  at: number,
  opts?: RevealOptions,
): boolean {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const config = requireIntentConfig(s, name);
  const reveal = resolveReveal(s.config, config, opts);
  return decideReveal(predict(s, name, at, opts), reveal);
}

/**
 * Records that the app acted on the intent at `at`. Starts the reveal cooldown, during which
 * `predict().revealed` is true and {@link shouldReveal} is false, and increments
 * `revealCount`. Evidence and learned data are untouched.
 *
 * @param state - The current state. Not mutated.
 * @param intent - Name of an intent declared in the config.
 * @param at - When the reveal happened.
 * @returns The next state.
 * @throws `RangeError` when `intent` is not declared in the config.
 * @throws `TypeError` when `state` is not an engine state or `at` is not finite.
 * @example
 * ```ts
 * state = markRevealed(state, 'upgrade', Date.now());
 * predict(state, 'upgrade', Date.now()).revealed; // true until the cooldown ends
 * ```
 */
export function markRevealed(state: EngineState, intent: string, at: number): EngineState {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const is = getIntentState(s, name, config);
  return {
    ...s,
    intents: {
      ...s.intents,
      [name]: { ...is, lastRevealedAt: t, revealCount: is.revealCount + 1 },
    },
  };
}
