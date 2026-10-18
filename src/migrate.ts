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
