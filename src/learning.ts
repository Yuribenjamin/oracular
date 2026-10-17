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
 * learned:   gain · |w0| · lift(qWith, qWithout), where qWith is the Laplace-smoothed outcome
 *            rate of episodes in which the signal was seen (hits / (hits + misses)) and
 *            qWithout the Laplace-smoothed outcome rate of the intent's other episodes
 *            (episodes without the signal). 0 until the signal has completed an episode.
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
  const qWith = laplace(record.hits, n);
  // The contrast: episodes of this intent in which the signal was not seen. hits + misses counts
  // the episodes it was seen in (one record per episode), so the rest is the complement.
  const totalEpisodes = state.episodes.hits + state.episodes.misses;
  const episodesWithout = Math.max(0, totalEpisodes - n);
  const outcomesWithout = Math.min(episodesWithout, Math.max(0, state.episodes.hits - record.hits));
  const qWithout = laplace(outcomesWithout, episodesWithout);
  // Nothing has been learned about a signal until it has been seen in a completed episode.
  const learned = n === 0 ? 0 : learning.gain * Math.abs(initial) * lift(qWith, qWithout);
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
