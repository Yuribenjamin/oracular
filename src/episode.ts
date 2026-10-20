import type { EpisodeIntentRecord, EpisodeState } from './types';
import { getOwn } from './util';

export function emptyEpisode(): EpisodeState {
  return { startedAt: null, lastEventAt: null, intents: {} };
}

/** If the episode has been idle longer than `timeout` by `at`, the moment it timed out; otherwise null. */
export function timedOutAt(
  episode: EpisodeState,
  timeout: number | undefined,
  at: number,
): number | null {
  if (timeout === undefined || episode.lastEventAt === null) return null;
  return at - episode.lastEventAt > timeout ? episode.lastEventAt + timeout : null;
}

/**
 * Opens the episode if needed and records activity at `at`, even when `at` is earlier than the
 * last activity: the idle gap is then measured from `at`, so one event stamped ahead of the clock
 * cannot keep the episode open until the clock catches up.
 */
export function extendEpisode(episode: EpisodeState, at: number): EpisodeState {
  return { startedAt: episode.startedAt ?? at, lastEventAt: at, intents: episode.intents };
}

export function episodeRecord(episode: EpisodeState, intent: string): EpisodeIntentRecord {
  return getOwn(episode.intents, intent) ?? { seen: [], counts: {}, resolved: false };
}

/** How many times `signal` has occurred for `intent` in this episode (since its last outcome). */
export function occurrences(episode: EpisodeState, intent: string, signal: string): number {
  return getOwn(episodeRecord(episode, intent).counts, signal) ?? 0;
}

/** Remembers one more occurrence of `signal`: added to `seen` the first time, counted every time. */
export function markSeen(episode: EpisodeState, intent: string, signal: string): EpisodeState {
  const record = episodeRecord(episode, intent);
  const seen = record.seen.includes(signal) ? record.seen : [...record.seen, signal];
  const counts = { ...record.counts, [signal]: (getOwn(record.counts, signal) ?? 0) + 1 };
  return { ...episode, intents: { ...episode.intents, [intent]: { ...record, seen, counts } } };
}

export function markResolved(episode: EpisodeState, intent: string): EpisodeState {
  return {
    ...episode,
    intents: { ...episode.intents, [intent]: { seen: [], counts: {}, resolved: true } },
  };
}
