/**
 * Version of the serialized state shape, stored in every state as `state.version`. Bumped only
 * when `EngineState` changes shape, and every bump ships its migration: {@link deserialize}
 * upgrades states saved by earlier versions of this library on its own (version 1, written by
 * oracular 0.1.0 to 0.2.x, version 2, written by 0.3.0 to 0.5.x, and version 3, written by 0.6.0
 * to 0.11.x, become version 4), reads a state one version newer than its own as its own (a
 * version bump only adds fields, so a rollback by one release keeps the user's history), and
 * calls your `migrate` function only for a version it does not know.
 *
 * @example
 * ```ts
 * import { STATE_VERSION, deserialize } from 'oracular';
 *
 * const state = deserialize(saved, {
 *   config,
 *   // Only reached for versions this library cannot migrate itself, such as a state written by a
 *   // newer oracular before a rollback.
 *   migrate: (stored, version) => {
 *     throw new Error(`cannot read oracular state version ${version} (this build reads ${STATE_VERSION})`);
 *   },
 * });
 * ```
 */
export const STATE_VERSION = 4 as const;

/**
 * Version of the recorder format: the `v` field of every record that {@link createRecord} and
 * {@link createEndRecord} produce. A new optional field does not change it; readers ignore fields
 * they do not know and skip records of a `kind` they do not know. Anything a reader written for
 * this version could misread bumps it.
 *
 * @example
 * ```ts
 * import { RECORD_VERSION } from 'oracular';
 *
 * const record = JSON.parse(line);
 * if (record.v !== RECORD_VERSION) throw new Error(`unsupported recorder format ${record.v}`);
 * ```
 */
export const RECORD_VERSION = 1 as const;
