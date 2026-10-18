import { expectTimestamp, resolveLearning, validateEvent } from './config';
import {
  emptyEpisode,
  episodeRecord,
  extendEpisode,
  markResolved,
  markSeen,
  occurrences,
  timedOutAt,
} from './episode';
import { applySignal, decayIntent, resetToPrior } from './intent';
import { decayLearned, recordEpisode, signalWeights } from './learning';
import { repeatFactor } from './math';
import { getIntentState, requireState } from './state';
import type { EngineState, IntentEvent, IntentState } from './types';
import { hasOwn } from './util';

/**
 * Feeds one event to the engine.
 *
 * For every intent the event is a signal of: decay its evidence to `event.at`, then add the
 * signal's effective weight to α (positive) or β (negative) and remember the signal for this
 * episode. Repeats within an episode saturate: the n-th occurrence of a signal adds
 * `w × log2(1 + 1/n)`, counted since the episode started or the intent's outcome last arrived.
 * That is the default when `config.episodeTimeout` is set, and `IntentConfig.saturate` overrides
 * it either way; otherwise every occurrence adds all of `w`. For every intent the event is the
 * outcome of: give the remembered signals a hit, count the episode toward the base rate, record
 * `lastOutcomeAt`, and (by default) reset the evidence to the prior. Any event opens or extends
 * the current episode; an idle gap longer than `config.episodeTimeout` closes the previous
 * episode first.
 *
 * @param state - The current state. Not mutated.
 * @param event - `name` is matched against every intent's signals and outcome; `at` is the
 *   event's timestamp, in the same unit as your durations; `props` are accepted and ignored,
 *   and never stored.
 * @returns The next state. Intents the event does not touch keep their stored numbers; their
 *   decay is applied when they are next read or updated.
 * @throws `TypeError` when `state` is not an engine state, or the event has no non-empty
 *   `name`, no finite `at`, or a `props` that is not a plain object.
 * @example
 * ```ts
 * let state = createState(config);
 * state = observe(state, { name: 'pricing.viewed', at: Date.now() });
 * state = observe(state, { name: 'upgrade.completed', at: Date.now() }); // outcome
 * ```
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
      const n = occurrences(episode, intentName, name) + 1;
      const saturate = intent.saturate ?? s.config.episodeTimeout !== undefined;
      const factor = saturate ? repeatFactor(n) : 1;
      is = applySignal(is, intent, name, effective * factor);
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
 * each signal seen this episode and counts the episode toward its base rate. Call it when a
 * session ends: tab closed, app backgrounded, user signed out.
 *
 * @param state - The current state. Not mutated.
 * @param at - When the episode ended. If it had already timed out under
 *   `config.episodeTimeout`, it is closed at the moment it timed out instead.
 * @returns The next state with no open episode, or the very same state object when no episode
 *   was open.
 * @throws `TypeError` when `state` is not an engine state or `at` is not a finite number.
 * @example
 * ```ts
 * window.addEventListener('pagehide', () => {
 *   state = endEpisode(state, Date.now());
 *   localStorage.setItem('oracular', serialize(state));
 * });
 * ```
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

/**
 * Whether an episode closed between two states: `prev` had an open episode and `next` either
 * has none or has a different one. Useful after `observe` or `endEpisode` to react to a
 * session ending, for example to persist, or to read the misses it produced as
 * `next.intents[x].episodes.misses - prev.intents[x].episodes.misses`.
 *
 * @param prev - The state before the operation.
 * @param next - The state after it.
 * @returns True when `prev.episode.startedAt` is not null and differs from
 *   `next.episode.startedAt`.
 * @throws `TypeError` when either argument is not an engine state.
 * @example
 * ```ts
 * const next = observe(state, event);
 * if (episodeClosed(state, next)) persist(next);
 * ```
 */
export function episodeClosed(prev: EngineState, next: EngineState): boolean {
  const a = requireState(prev);
  const b = requireState(next);
  return a.episode.startedAt !== null && b.episode.startedAt !== a.episode.startedAt;
}
