import type { EpisodeState } from './types';

export function emptyEpisode(): EpisodeState {
  return { startedAt: null, lastEventAt: null, intents: {} };
}
