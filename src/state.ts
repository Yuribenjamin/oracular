import { normalizeConfig } from './config';
import { emptyEpisode } from './episode';
import { initIntent } from './intent';
import type { EngineConfig, EngineState, IntentConfig, IntentState } from './types';
import { getOwn, isRecord } from './util';
import { STATE_VERSION } from './version';

/** Builds a fresh state: every intent starts at its prior, no episode is open. */
export function createState(config: EngineConfig): EngineState {
  const normalized = normalizeConfig(config);
  const intents: Record<string, IntentState> = {};
  for (const [name, intent] of Object.entries(normalized.intents)) {
    intents[name] = initIntent(intent);
  }
  return { version: STATE_VERSION, config: normalized, intents, episode: emptyEpisode() };
}

export function requireState(state: unknown): EngineState {
  if (
    !isRecord(state) ||
    state.version !== STATE_VERSION ||
    !isRecord(state.config) ||
    !isRecord(state.intents) ||
    !isRecord(state.episode)
  ) {
    throw new TypeError('oracular: state must be an EngineState from createState or deserialize');
  }
  return state as unknown as EngineState;
}

export function requireIntentConfig(state: EngineState, name: string): IntentConfig {
  const intent = getOwn(state.config.intents, name);
  if (intent === undefined) {
    throw new RangeError(`oracular: unknown intent ${JSON.stringify(name)}`);
  }
  return intent;
}

/** The stored intent state, or a fresh prior if the intent was added to the config after the state was created. */
export function getIntentState(
  state: EngineState,
  name: string,
  intent: IntentConfig,
): IntentState {
  return getOwn(state.intents, name) ?? initIntent(intent);
}
