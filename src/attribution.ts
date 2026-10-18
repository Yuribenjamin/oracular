import type { ResolvedLearning } from './config';
import { decayLearned, recordEpisode } from './learning';
import { decayFactor } from './math';
import type { IntentConfig, IntentState, PendingEpisode } from './types';

/** Most closed episodes one intent keeps waiting for its outcome. Past it the oldest is a miss at once. */
export const MAX_PENDING = 32;

/**
 * When a waiting episode's window ends: its close plus the intent's `attribution`. 0 when the
 * intent no longer sets one, so an episode held under an earlier config settles on the next touch.
 */
function expiry(episode: PendingEpisode, intent: IntentConfig): number {
  return episode.endedAt + (intent.attribution ?? 0);
}

/**
 * Brings the learned counts up to `at`. Every waiting episode whose window has ended by then is a
 * miss, recorded at the moment its window ended (the counts are decayed to that moment first, as
 * for an episode that closes by timing out), and the counts are then decayed to `at`. Every path
 * that reads or writes learned counts goes through here, so no verdict lands out of order.
 */
export function settlePending(
  state: IntentState,
  intent: IntentConfig,
  learning: ResolvedLearning,
  at: number,
): IntentState {
  let is = state;
  let settled = 0;
  for (const episode of state.pending) {
    const end = expiry(episode, intent);
    if (!(end < at)) break;
    is = recordEpisode(decayLearned(is, learning, end), episode.seen, 0);
    settled++;
  }
  if (settled > 0) is = { ...is, pending: state.pending.slice(settled) };
  return decayLearned(is, learning, at);
}

/**
 * Holds a closed episode for the intent's outcome instead of counting it, in order of close. Past
 * {@link MAX_PENDING} the oldest is a miss at once, so the stored state stays bounded whatever the
 * session cadence.
 */
export function deferEpisode(
  state: IntentState,
  seen: readonly string[],
  endedAt: number,
): IntentState {
  const pending = insert(state.pending, { endedAt, seen: [...seen] });
  if (pending.length <= MAX_PENDING) return { ...state, pending };
  const [oldest, ...rest] = pending;
  return { ...recordEpisode(state, (oldest as PendingEpisode).seen, 0), pending: rest };
}

/** Keeps the list in order of close; a clock that went backwards inserts before later closes. */
function insert(pending: readonly PendingEpisode[], episode: PendingEpisode): PendingEpisode[] {
  let i = pending.length;
  while (i > 0 && (pending[i - 1] as PendingEpisode).endedAt > episode.endedAt) i--;
  return [...pending.slice(0, i), episode, ...pending.slice(i)];
}

/**
 * The outcome arrived at `at`: every waiting episode gets the share `2^(−age / halfLife)` of a hit
 * that its evidence would still hold now, and the rest of a miss, so each episode still counts
 * exactly once. The list is then empty.
 */
export function creditPending(state: IntentState, intent: IntentConfig, at: number): IntentState {
  if (state.pending.length === 0) return state;
  let is = state;
  for (const episode of state.pending) {
    is = recordEpisode(is, episode.seen, decayFactor(at - episode.endedAt, intent.halfLife));
  }
  return { ...is, pending: [] };
}
