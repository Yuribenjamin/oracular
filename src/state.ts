import { normalizeConfig } from './config';
import { emptyEpisode } from './episode';
import { initIntent } from './intent';
import type { EngineConfig, EngineState, IntentConfig, IntentState } from './types';
import { getOwn, isRecord } from './util';
import { STATE_VERSION } from './version';

/**
 * Builds a fresh engine state from a config. Every intent starts at its prior and no episode is
 * open. The config is validated and a normalized copy is stored inside the state, so a persisted
 * state remembers the weights it was built with; pass your current config to {@link deserialize}
 * when loading. `config.learning.lift` selects the lift formula; omitting it preserves the
 * normalized difference used by existing configs and states.
 *
 * @param config - Intents with their priors and signals, plus engine-wide options. Validated
 *   strictly: unknown keys, non-finite numbers and out-of-range values throw.
 * @returns A new, JSON-serializable state. `config` is not mutated.
 * @throws `TypeError` when a value has the wrong type or a key is not recognised.
 * @throws `RangeError` when a number is out of range, for example a `prior` outside (0, 1), a
 *   signal weight of 0, or a weight, `priorStrength`, `learning.gain` or
 *   `learning.priorEpisodes` beyond 1e6 (larger values could overflow the arithmetic).
 * @example
 * ```ts
 * const state = createState({
 *   intents: {
 *     upgrade: {
 *       prior: 0.05,
 *       priorStrength: 10,
 *       halfLife: 7 * 24 * 60 * 60 * 1000,
 *       signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'plan.downgraded': -4 },
 *       outcome: 'upgrade.completed',
 *     },
 *   },
 * });
 * ```
 */
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
