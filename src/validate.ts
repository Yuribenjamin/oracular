import { normalizeConfig } from './config';
import type { EngineConfig } from './types';

/**
 * Checks a config exactly as {@link createState} and {@link deserialize} do, without building a
 * state, and returns the normalized copy they would store: only the recognised keys, in a fixed
 * order, with every `undefined` dropped, so it survives a JSON round trip unchanged. Use it to
 * fail fast at startup or in a test, or on a config loaded from a file, before the engine runs.
 *
 * @param config - The config to check. Typed `unknown` so parsed JSON can be passed as it is.
 * @returns A fresh, normalized {@link EngineConfig}. `config` is not mutated.
 * @throws `TypeError` when a value has the wrong type, a key is not recognised, or an intent's
 *   `outcome` is also one of its signals while `resetOnOutcome` is on.
 * @throws `RangeError` when a number is out of range: a `prior` outside (0, 1), a signal weight of
 *   0, a reveal `threshold` of 0 or 1, a `z` above 10, or a weight, `priorStrength`,
 *   `learning.gain` or `learning.priorEpisodes` beyond 1e6.
 * @example
 * ```ts
 * import { readFileSync } from 'node:fs';
 * import { validateConfig } from 'oracular';
 *
 * // Throws with the offending path in the message, e.g. config.intents["upgrade"].prior
 * const config = validateConfig(JSON.parse(readFileSync('oracular.config.json', 'utf8')));
 * ```
 */
export function validateConfig(config: unknown): EngineConfig {
  return normalizeConfig(config);
}
