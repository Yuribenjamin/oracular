import { expectTimestamp, resolveLearning, validateEvent } from './config';
import {
  emptyEpisode,
  episodeRecord,
  extendEpisode,
  markResolved,
  markSeen,
  timedOutAt,
} from './episode';
import { applySignal, decayIntent, resetToPrior } from './intent';
import { decayLearned, recordEpisode, signalWeights } from './learning';
import { getIntentState, requireState } from './state';
import type { EngineState, IntentEvent, IntentState } from './types';
import { hasOwn } from './util';

/**
 * Feeds one event to the engine.
 *
 * For every intent the event is a signal of: decay its evidence to `event.at`, then add the
 * signal's effective weight to α (positive) or β (negative) and remember the signal for this
 * episode. For every intent the event is the outcome of: give the remembered signals a hit,
 * count the episode toward the base rate, record `lastOutcomeAt`, and (by default) reset the
 * evidence to the prior.
 * Any event opens or extends the current episode; an idle gap longer than
 * `config.episodeTimeout` closes the previous episode first.
 */
export function observe(state: EngineState, event: IntentEvent): EngineState {
  let s = requireState(state);
  const { name, at } = validateEvent(event);

  const closeAt = timedOutAt(s.episode, s.config.episodeTimeout, at);
  if (closeAt !== null) s = closeEpisode(s, closeAt);

  const learning = resolveLearning(s.config);
  const intents: Record<string, IntentState> = { ...s.intents };
  let episode = extendEpisode(s.episode, at);

  for (const [intentName, intent] of Object.entries(s.config.intents)) {
    const isSignal = hasOwn(intent.signals, name);
    const isOutcome = intent.outcome === name;
    if (!isSignal && !isOutcome) continue;

    let is = getIntentState(s, intentName, intent);
    is = decayIntent(is, intent, at);
    is = decayLearned(is, learning, at);

    if (isSignal) {
      const { effective } = signalWeights(is, intent, learning, name);
      is = applySignal(is, intent, name, effective);
      // An event that is also the intent's outcome must not learn from itself.
      if (!isOutcome) episode = markSeen(episode, intentName, name);
    }

    if (isOutcome) {
      is = recordEpisode(is, episodeRecord(episode, intentName).seen, true);
      episode = markResolved(episode, intentName);
      is = { ...is, lastOutcomeAt: at };
      if (intent.resetOnOutcome ?? true) is = resetToPrior(is, intent);
    }

    intents[intentName] = is;
  }

  return { ...s, intents, episode };
}

/**
 * Ends the current episode at `at`. Every intent whose outcome did not arrive gives a miss to
 * each signal seen this episode and counts the episode toward its base rate. Returns the same
 * state when no episode is open.
 */
export function endEpisode(state: EngineState, at: number): EngineState {
  const s = requireState(state);
  const t = expectTimestamp(at, 'at');
  if (s.episode.startedAt === null) return s;
  const closeAt = timedOutAt(s.episode, s.config.episodeTimeout, t);
  return closeEpisode(s, closeAt ?? t);
}

function closeEpisode(state: EngineState, at: number): EngineState {
  const learning = resolveLearning(state.config);
  const intents: Record<string, IntentState> = { ...state.intents };
  for (const [intentName, intent] of Object.entries(state.config.intents)) {
    const record = episodeRecord(state.episode, intentName);
    if (record.resolved) continue;
    let is = getIntentState(state, intentName, intent);
    is = decayLearned(is, learning, at);
    is = recordEpisode(is, record.seen, false);
    intents[intentName] = is;
  }
  return { ...state, intents, episode: emptyEpisode() };
}
