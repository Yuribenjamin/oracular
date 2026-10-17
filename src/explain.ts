import { expectName, expectTimestamp, resolveLearning } from './config';
import { decayIntent } from './intent';
import { decayLearned, signalWeights } from './learning';
import { betaMean } from './math';
import { getIntentState, requireIntentConfig, requireState } from './state';
import type { EngineState, SignalExplanation } from './types';
import { getOwn } from './util';

/**
 * Why the intent's p is what it is at time `at`: one entry per declared signal, the ones that
 * matter most first. `contribution` is the signed pseudo-count the signal currently holds,
 * `impact` is how much p would drop (or rise) if that contribution were removed.
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
