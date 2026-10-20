import type { ResolvedLearning } from './config';
import { decayFactor, laplace, learningScore, lift } from './math';
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
 * learned:   gain · |w0| · the signed, bounded score of the configured lift. qWith is the
 *            Laplace-smoothed outcome rate where the signal was seen (hits / (hits + misses));
 *            qWithout the Laplace-smoothed outcome rate of the intent's other episodes
 *            (episodes without the signal). 0 until the signal has completed an episode.
 * effective: (k · w0 + nEff · learned) / (k + nEff), with k = learning.priorEpisodes and
 *            nEff = (nWith · nWithout) / (nWith + nWithout): the comparison is only trusted once
 *            the signal has been both present and absent. A signal that has never been absent
 *            (or never present) has no counterfactual, nEff is 0, and the developer's weight stands.
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
  const nWith = record.hits + record.misses;
  const qWith = laplace(record.hits, nWith);
  // The contrast: episodes of this intent in which the signal was not seen. hits + misses counts
  // the episodes it was seen in (one record per episode), so the rest is the complement.
  const totalEpisodes = state.episodes.hits + state.episodes.misses;
  const nWithout = Math.max(0, totalEpisodes - nWith);
  const outcomesWithout = Math.min(nWithout, Math.max(0, state.episodes.hits - record.hits));
  const qWithout = laplace(outcomesWithout, nWithout);
  // Nothing has been learned about a signal until it has been seen in a completed episode.
  // +1 in each cell of the signal × outcome table agrees with the two Laplace-smoothed rates.
  const baseline =
    learning.lift === 'association-rule'
      ? (record.hits + outcomesWithout + 2) / (nWith + nWithout + 4)
      : qWithout;
  const score = learningScore(lift(qWith, baseline, learning.lift), learning.lift);
  const learned = nWith === 0 ? 0 : learning.gain * Math.abs(initial) * score;
  // Learning needs contrast: weight the comparison by how much of both sides has been seen.
  const nEff = nWith + nWithout === 0 ? 0 : (nWith * nWithout) / (nWith + nWithout);
  const k = learning.priorEpisodes;
  const effective = (k * initial + nEff * learned) / (k + nEff);
  return { initial, learned, effective, hits: record.hits, misses: record.misses };
}

/**
 * Counts one episode for the listed signals and for the base rate: `credit` of a hit and
 * `1 − credit` of a miss. 1 when the outcome arrived in the episode, 0 when it ended without it,
 * and in between for an episode a later outcome credits under `attribution` (see attribution.ts).
 * Whatever the credit, the episode counts exactly once.
 */
export function recordEpisode(
  state: IntentState,
  signals: readonly string[],
  credit: number,
): IntentState {
  const miss = 1 - credit;
  const learned = { ...state.learned };
  for (const signal of signals) {
    const r = getOwn(learned, signal) ?? NONE;
    learned[signal] = { hits: r.hits + credit, misses: r.misses + miss };
  }
  const episodes = { hits: state.episodes.hits + credit, misses: state.episodes.misses + miss };
  return { ...state, learned, episodes };
}
