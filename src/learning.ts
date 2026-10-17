import type { ResolvedLearning } from './config';
import { decayFactor, laplace, lift } from './math';
import type { IntentConfig, IntentState, SignalRecord } from './types';
import { getOwn, mapRecord } from './util';

const NONE: SignalRecord = { hits: 0, misses: 0 };

/** Decays learned counts toward 0 by 2^(−Δt / learning.halfLife) and moves the anchor to `at`. */
export function decayLearned(
  state: IntentState,
  learning: ResolvedLearning,
  at: number,
): IntentState {
  if (state.learnedAt === null) return { ...state, learnedAt: at };
  const learnedAt = Math.max(state.learnedAt, at);
  const d = learning.halfLife === null ? 1 : decayFactor(at - state.learnedAt, learning.halfLife);
  if (d === 1) return learnedAt === state.learnedAt ? state : { ...state, learnedAt };
  return {
    ...state,
    learnedAt,
    learned: mapRecord(state.learned, (r) => ({ hits: r.hits * d, misses: r.misses * d })),
    episodes: { hits: state.episodes.hits * d, misses: state.episodes.misses * d },
  };
}

export interface SignalWeights {
  initial: number;
  learned: number;
  effective: number;
  hits: number;
  misses: number;
}

/**
 * initial:   the developer's weight w0.
 * learned:   gain · |w0| · lift(q, b), where q is the signal's Laplace-smoothed hit rate and
 *            b the intent's Laplace-smoothed base rate (episodes ending with the outcome).
 * effective: (k · w0 + n · learned) / (k + n), with k = learning.priorEpisodes and n = hits + misses.
 */
export function signalWeights(
  state: IntentState,
  intent: IntentConfig,
  learning: ResolvedLearning,
  signal: string,
): SignalWeights {
  const initial = getOwn(intent.signals, signal);
  if (initial === undefined) {
    throw new RangeError(`oracular: ${JSON.stringify(signal)} is not a signal of this intent`);
  }
  const record = getOwn(state.learned, signal) ?? NONE;
  const n = record.hits + record.misses;
  const q = laplace(record.hits, n);
  const b = laplace(state.episodes.hits, state.episodes.hits + state.episodes.misses);
  // Nothing has been learned about a signal until it has been seen in a completed episode.
  const learned = n === 0 ? 0 : learning.gain * Math.abs(initial) * lift(q, b);
  const k = learning.priorEpisodes;
  const effective = (k * initial + n * learned) / (k + n);
  return { initial, learned, effective, hits: record.hits, misses: record.misses };
}

/** Gives each listed signal a hit (outcome arrived) or a miss (episode ended without it), and counts the episode. */
export function recordEpisode(
  state: IntentState,
  signals: readonly string[],
  outcome: boolean,
): IntentState {
  const learned = { ...state.learned };
  for (const signal of signals) {
    const r = getOwn(learned, signal) ?? NONE;
    learned[signal] = outcome
      ? { hits: r.hits + 1, misses: r.misses }
      : { hits: r.hits, misses: r.misses + 1 };
  }
  const episodes = outcome
    ? { hits: state.episodes.hits + 1, misses: state.episodes.misses }
    : { hits: state.episodes.hits, misses: state.episodes.misses + 1 };
  return { ...state, learned, episodes };
}
