import { hasOwn, isRecord } from './util';

type Stored = Record<string, unknown>;

/**
 * Migrations this library applies itself, keyed by the version they upgrade from. Each turns the
 * parsed JSON of one version into the shape of the next. Input that is malformed in ways a
 * migration does not need to look at is passed through untouched, so that parsing afterwards
 * rejects it with the same precise error it would give any other malformed state.
 */
const MIGRATIONS: Record<number, (stored: Stored) => Stored> = {
  1: fromV1,
  2: fromV2,
  3: fromV3,
};

/** Whether `version` is one this library can bring up to date on its own. */
export function canMigrate(version: number): boolean {
  return hasOwn(MIGRATIONS, String(version));
}

/** Applies the built-in migrations, one version at a time, until none applies. */
export function migrateStored(stored: Stored): Stored {
  let current = stored;
  while (typeof current.version === 'number' && canMigrate(current.version)) {
    current = (MIGRATIONS[current.version] as (stored: Stored) => Stored)(current);
  }
  return current;
}

/**
 * Version 1 (oracular 0.1.0 to 0.2.x) → 2. Version 2 counts how often each signal occurred in the
 * open episode, so that repeats can saturate. A version 1 state only knows which signals were
 * seen, not how often, so each seen signal counts once: the lower bound. Nothing else changes, so
 * α, β and every learned count, and therefore every estimate, are exactly what they were.
 */
function fromV1(stored: Stored): Stored {
  const episode = stored.episode;
  if (!isRecord(episode) || !isRecord(episode.intents)) return { ...stored, version: 2 };
  const intents: Stored = {};
  for (const key of Object.keys(episode.intents)) {
    if (key === '__proto__') continue;
    const record = episode.intents[key];
    if (isRecord(record) && Array.isArray(record.seen)) {
      const counts: Record<string, number> = {};
      for (const signal of record.seen) {
        if (typeof signal === 'string' && signal !== '__proto__') counts[signal] = 1;
      }
      intents[key] = { ...record, counts };
    } else {
      intents[key] = record;
    }
  }
  return { ...stored, version: 2, episode: { ...episode, intents } };
}

/**
 * Version 2 (oracular 0.3.0 to 0.5.x) → 3. Version 3 lets an intent hold closed episodes that wait
 * for the outcome under `IntentConfig.attribution`. A version 2 state holds none, so every intent
 * gets an empty list and nothing else changes: α, β and every learned count, and therefore every
 * estimate, are exactly what they were.
 */
function fromV2(stored: Stored): Stored {
  if (!isRecord(stored.intents)) return { ...stored, version: 3 };
  const intents: Stored = {};
  for (const key of Object.keys(stored.intents)) {
    if (key === '__proto__') continue;
    const intent = stored.intents[key];
    intents[key] = isRecord(intent) ? { ...intent, pending: [] } : intent;
  }
  return { ...stored, version: 3, intents };
}

/**
 * Version 3 (oracular 0.6.0 to 0.11.x) → 4. Version 4 adds the engine's clock: the latest event
 * time it trusts, and one event stamped behind it awaiting confirmation. The migration adds an
 * empty clock; `deserialize` then sets it to the latest time the stored anchors were written at,
 * as it does for any state whose anchors are ahead of its clock. Nothing else changes, so every
 * estimate is exactly what it was.
 */
function fromV3(stored: Stored): Stored {
  return { ...stored, version: 4, clock: { at: null, behindAt: null } };
}
