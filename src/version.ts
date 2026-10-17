/**
 * Version of the serialized state shape, stored in every state as `state.version`.
 * {@link deserialize} compares it with the stored value and calls your `migrate` function when
 * they differ. Bumped only when `EngineState` changes incompatibly.
 *
 * @example
 * ```ts
 * import { STATE_VERSION, deserialize } from 'oracular';
 *
 * const state = deserialize(saved, {
 *   migrate: (stored, version) => {
 *     if (version === 0) return upgradeFromV0(stored);
 *     throw new Error(`cannot migrate version ${version} to ${STATE_VERSION}`);
 *   },
 * });
 * ```
 */
export const STATE_VERSION = 1 as const;
