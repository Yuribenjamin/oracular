import { assessIntent, buildExplanation } from './assess';
import { expectName, expectTimestamp, normalizeExplainOptions, resolveLearning } from './config';
import { requireIntentConfig, requireState } from './state';
import type { EngineState, ExplainOptions, SignalExplanation } from './types';

/**
 * Why the intent's p is what it is at time `at`: one entry per declared signal, the ones that
 * matter most first. `contribution` is the signed pseudo-count the signal currently holds after
 * decay, `impact` is how much p would change if that contribution were removed, and the three
 * weights show what the developer said, what this user's history says, and what the next
 * occurrence will actually add. Read-only.
 *
 * @param state - The current state. Not mutated.
 * @param intent - Name of an intent declared in the config.
 * @param at - The time to evaluate at; contributions and learned counts are decayed to it.
 * @param opts - Optional filters: `nonZero` keeps only signals that currently hold evidence,
 *   `limit` caps the number of rows. Default: every declared signal.
 * @returns One {@link SignalExplanation} per declared signal, sorted by |impact| descending,
 *   then by name, then filtered by `opts`. Empty for an intent that declares no signals.
 * @throws `RangeError` when `intent` is not declared in the config.
 * @throws `TypeError` when `state` is not an engine state, `at` is not finite, or `opts` is
 *   malformed.
 * @example
 * ```ts
 * for (const row of explain(state, 'upgrade', Date.now(), { nonZero: true })) {
 *   console.log(row.signal, row.impact.toFixed(2), row.effectiveWeight.toFixed(2));
 * }
 * ```
 */
export function explain(
  state: EngineState,
  intent: string,
  at: number,
  opts?: ExplainOptions,
): SignalExplanation[] {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const filters = opts === undefined ? {} : normalizeExplainOptions(opts, 'options');
  const learning = resolveLearning(s.config);
  return buildExplanation(assessIntent(s, name, config, learning, t), config, learning, filters);
}
