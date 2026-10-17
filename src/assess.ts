import type { ResolvedLearning, ResolvedReveal } from './config';
import { decayIntent } from './intent';
import { decayLearned, signalWeights } from './learning';
import { betaMean, betaSd, clamp01 } from './math';
import { getIntentState } from './state';
import type {
  EngineState,
  ExplainOptions,
  IntentConfig,
  IntentState,
  Prediction,
  SignalExplanation,
} from './types';
import { getOwn } from './util';

/** The intent decayed to `at` (evidence and learned counts), without storing anything. */
export function assessIntent(
  state: EngineState,
  name: string,
  intent: IntentConfig,
  learning: ResolvedLearning,
  at: number,
): IntentState {
  return decayLearned(decayIntent(getIntentState(state, name, intent), intent, at), learning, at);
}

/** The end of a cooldown that started at `since`, if it is still running at `at`. */
function cooldownEnd(since: number | null, cooldown: number, at: number): number | null {
  if (since === null) return null;
  const end = since + cooldown;
  return at < end ? end : null;
}

export function buildPrediction(
  is: IntentState,
  name: string,
  reveal: ResolvedReveal,
  at: number,
): Prediction {
  const p = betaMean(is.alpha, is.beta);
  const sd = betaSd(is.alpha, is.beta);
  const revealEnd = cooldownEnd(is.lastRevealedAt, reveal.cooldown, at);
  const outcomeEnd = cooldownEnd(is.lastOutcomeAt, reveal.cooldown, at);
  const suppressedUntil =
    revealEnd === null
      ? outcomeEnd
      : outcomeEnd === null
        ? revealEnd
        : Math.max(revealEnd, outcomeEnd);
  return {
    intent: name,
    p,
    sd,
    lower: clamp01(p - reveal.z * sd),
    confidence: clamp01(1 - 2 * sd),
    evidence: is.alpha + is.beta,
    revealed: revealEnd !== null,
    revealedAt: is.lastRevealedAt,
    suppressedUntil,
  };
}

export function decideReveal(prediction: Prediction, reveal: ResolvedReveal): boolean {
  return (
    prediction.suppressedUntil === null &&
    prediction.p >= reveal.threshold &&
    prediction.lower >= reveal.threshold
  );
}

export function buildExplanation(
  is: IntentState,
  intent: IntentConfig,
  learning: ResolvedLearning,
  opts: ExplainOptions,
): SignalExplanation[] {
  const p = betaMean(is.alpha, is.beta);
  const out: SignalExplanation[] = [];
  for (const signal of Object.keys(intent.signals)) {
    const c = getOwn(is.contributions, signal) ?? { alpha: 0, beta: 0 };
    const w = signalWeights(is, intent, learning, signal);
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
  const filtered = opts.nonZero ? out.filter((row) => row.contribution !== 0) : out;
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit);
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
