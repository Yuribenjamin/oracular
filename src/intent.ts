import { decayFactor } from './math';
import type { IntentConfig, IntentState, SignalContribution } from './types';
import { getOwn, mapRecord } from './util';

export function priorCounts(intent: IntentConfig): { alpha0: number; beta0: number } {
  return {
    alpha0: intent.prior * intent.priorStrength,
    beta0: (1 - intent.prior) * intent.priorStrength,
  };
}

export function initIntent(intent: IntentConfig): IntentState {
  const { alpha0, beta0 } = priorCounts(intent);
  return {
    alpha: alpha0,
    beta: beta0,
    updatedAt: null,
    contributions: {},
    learned: {},
    episodes: { hits: 0, misses: 0 },
    learnedAt: null,
    lastRevealedAt: null,
    revealCount: 0,
  };
}

/**
 * The one place α and β are written: always the prior plus the sum of contributions,
 * so the invariant α = α0 + Σ contributions.alpha (and β likewise) holds by construction.
 */
export function withContributions(
  state: IntentState,
  intent: IntentConfig,
  contributions: Record<string, SignalContribution>,
): IntentState {
  const { alpha0, beta0 } = priorCounts(intent);
  let alpha = alpha0;
  let beta = beta0;
  for (const c of Object.values(contributions)) {
    alpha += c.alpha;
    beta += c.beta;
  }
  return { ...state, alpha, beta, contributions };
}

/** Decays evidence toward the prior by 2^(−Δt / halfLife) and moves the anchor to `at`. */
export function decayIntent(state: IntentState, intent: IntentConfig, at: number): IntentState {
  if (state.updatedAt === null) return { ...state, updatedAt: at };
  const d = decayFactor(at - state.updatedAt, intent.halfLife);
  const updatedAt = Math.max(state.updatedAt, at);
  if (d === 1) return updatedAt === state.updatedAt ? state : { ...state, updatedAt };
  const contributions = mapRecord(state.contributions, (c) => ({
    alpha: c.alpha * d,
    beta: c.beta * d,
  }));
  return withContributions({ ...state, updatedAt }, intent, contributions);
}

/** Adds `weight` pseudo-counts for the intent (positive → α) or against it (negative → β). */
export function applySignal(
  state: IntentState,
  intent: IntentConfig,
  signal: string,
  weight: number,
): IntentState {
  const prev = getOwn(state.contributions, signal) ?? { alpha: 0, beta: 0 };
  const next: SignalContribution =
    weight >= 0
      ? { alpha: prev.alpha + weight, beta: prev.beta }
      : { alpha: prev.alpha, beta: prev.beta - weight };
  return withContributions(state, intent, { ...state.contributions, [signal]: next });
}

/** Drops all evidence; α and β return to the prior. Learned data is untouched. */
export function resetToPrior(state: IntentState, intent: IntentConfig): IntentState {
  return withContributions(state, intent, {});
}
