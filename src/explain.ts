import { expectName, expectTimestamp, resolveLearning } from './config';
import { decayIntent } from './intent';
import { decayLearned, signalWeights } from './learning';
import { betaMean } from './math';
import { getIntentState, requireIntentConfig, requireState } from './state';
import type { EngineState, SignalExplanation } from './types';
import { getOwn } from './util';

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
 * @returns One {@link SignalExplanation} per declared signal, sorted by |impact| descending,
 *   then by name. Empty for an intent that declares no signals.
 * @throws {RangeError} When `intent` is not declared in the config.
 * @throws {TypeError} When `state` is not an engine state or `at` is not finite.
 * @example
 * ```ts
 * for (const row of explain(state, 'upgrade', Date.now())) {
 *   console.log(row.signal, row.impact.toFixed(2), row.effectiveWeight.toFixed(2));
 * }
 * ```
 */
export function explain(state: EngineState, intent: string, at: number): SignalExplanation[] {
  const s = requireState(state);
  const name = expectName(intent, 'intent');
  const t = expectTimestamp(at, 'at');
  const config = requireIntentConfig(s, name);
  const learning = resolveLearning(s.config);

  let is = decayIntent(getIntentState(s, name, config), config, t);
  is = decayLearned(is, learning, t);
  const p = betaMean(is.alpha, is.beta);

  const out: SignalExplanation[] = [];
  for (const signal of Object.keys(config.signals)) {
    const c = getOwn(is.contributions, signal) ?? { alpha: 0, beta: 0 };
    const w = signalWeights(is, config, learning, signal);
    const without = betaMean(is.alpha - c.alpha, is.beta - c.beta);
    out.push({
      signal,
      contribution: c.alpha - c.beta,
      impact: p - without,
      initialWeight: w.initial,
      learnedWeight: w.learned,
      effectiveWeight: w.effective,
      hits: w.hits,
      misses: w.misses,
    });
  }

  out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || compare(a.signal, b.signal));
  return out;
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
