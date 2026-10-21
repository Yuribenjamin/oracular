import type { PersistAdapter, PersistRelease } from './persist';

const owners = new WeakMap<object, Set<string>>();

export function occupied(): Error {
  return new Error(
    '@oracular/react: persistence is already owned by another store; share that store or await its dispose() before loading this one',
  );
}

/** Exclusive ownership within this JavaScript runtime, including native and custom adapters. */
export function claim(target: object, key: string): PersistRelease {
  let keys = owners.get(target);
  if (keys === undefined) {
    keys = new Set();
    owners.set(target, keys);
  }
  if (keys.has(key)) throw occupied();
  keys.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keys.delete(key);
  };
}

export function acquirePersistence(
  adapter: PersistAdapter,
): PersistRelease | Promise<PersistRelease> {
  const local = claim(adapter, '');
  const wrap =
    (release?: PersistRelease): PersistRelease =>
    async () => {
      try {
        await release?.();
      } finally {
        local();
      }
    };
  try {
    const release = adapter.acquire?.();
    if (release === undefined || typeof release === 'function') return wrap(release);
    return release.then(wrap, (error) => {
      local();
      throw error;
    });
  } catch (error) {
    local();
    throw error;
  }
}

/** Hold the browser lock until dispose has finished all storage writes. */
export function browserClaim(key: string): Promise<PersistRelease> {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) {
    return Promise.reject(
      new Error(
        '@oracular/react: localStorage persistence requires Web Locks (a secure context); use a custom adapter with exclusive ownership in this environment',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const done = locks.request(
      `@oracular/react:localStorage:${key}`,
      { ifAvailable: true },
      (lock) => {
        if (lock === null) throw occupied();
        return new Promise<void>((release) => {
          resolve(() => {
            release();
            return done.then(() => {});
          });
        });
      },
    );
    void done.catch(reject);
  });
}
