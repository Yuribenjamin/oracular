// @vitest-environment node
import { createState, deserialize, endEpisode, observe } from 'oracular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asyncStorageAdapter,
  createIntentStore,
  localStorageAdapter,
  mmkvAdapter,
  type PersistAdapter,
} from '../src';
import { slowSaveAdapter, T } from './adapters';

const config = {
  episodeTimeout: 100,
  intents: {
    tip: {
      prior: 0.2,
      priorStrength: 10,
      halfLife: 1000,
      signals: { a: 3, b: 2 },
      outcome: 'done',
      attribution: 500,
    },
  },
};

function backend(kind: string) {
  const values = new Map<string, string>();
  const sync = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, json: string) => {
      values.set(key, json);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const async = {
    getItem: async (key: string) => sync.getItem(key),
    setItem: async (key: string, json: string) => sync.setItem(key, json),
    removeItem: async (key: string) => sync.removeItem(key),
  };
  const mmkv = {
    getString: (key: string) => values.get(key),
    set: sync.setItem,
    delete: sync.removeItem,
  };
  const locks = new Set<string>();
  const make = (key = 'state'): PersistAdapter => {
    if (kind === 'web storage') return localStorageAdapter(key, sync);
    if (kind === 'AsyncStorage') return asyncStorageAdapter(key, async);
    if (kind === 'MMKV') return mmkvAdapter(key, mmkv);
    return {
      acquire: async () => {
        if (locks.has(key)) throw new Error('platform lock busy');
        locks.add(key);
        return () => {
          locks.delete(key);
        };
      },
      load: () => async.getItem(key),
      save: (json) => async.setItem(key, json),
      remove: () => async.removeItem(key),
    };
  };
  return { make, values };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

for (const kind of ['web storage', 'AsyncStorage', 'MMKV', 'custom platform lock']) {
  describe(`${kind} ownership without a browser environment`, () => {
    it('preserves successive episodes through 50 contested ownership transfers and 5,000 events', async () => {
      const io = backend(kind);
      let expected = createState(config);
      let at = T;
      for (let round = 0; round < 50; round++) {
        const first = createIntentStore(config, { persist: io.make(), now: () => at });
        const errors: unknown[] = [];
        const second = createIntentStore(config, {
          persist: io.make(),
          now: () => at,
          onError: (e) => errors.push(e),
        });
        await first.load();
        await second.load();
        expect(second.getStatus()).toBe('failed');
        // A losing clear must not erase the owner's history either.
        await second.clear();
        expect(second.getStatus()).toBe('failed');
        for (let event = 0; event < 50; event++) {
          at += event % 3 === 0 ? 101 : 1;
          const name = event % 4 === 0 ? 'done' : 'a';
          first.track(name);
          expected = observe(expected, { name, at });
        }
        first.endEpisode();
        expected = endEpisode(expected, at);
        await first.flush();
        expect(deserialize(io.values.get('state')!)).toStrictEqual(expected);
        await first.dispose();
        await second.load();
        expect(second.getState()).toStrictEqual(expected);
        for (let event = 0; event < 50; event++) {
          at += event % 3 === 0 ? 101 : 1;
          const name = event % 4 === 0 ? 'done' : 'b';
          second.track(name);
          expected = observe(expected, { name, at });
        }
        second.endEpisode();
        expected = endEpisode(expected, at);
        await second.flush();
        expect(deserialize(io.values.get('state')!)).toStrictEqual(expected);
        expect(errors.length).toBeGreaterThan(0);
        await second.dispose();
      }
    }, 30_000);

    it('allows independent keys and makes release idempotent', async () => {
      const io = backend(kind);
      const a = createIntentStore(config, { persist: io.make('a') });
      const b = createIntentStore(config, { persist: io.make('b') });
      await Promise.all([a.load(), b.load()]);
      expect([a.getStatus(), b.getStatus()]).toStrictEqual(['loaded', 'loaded']);
      await a.dispose();
      const next = createIntentStore(config, { persist: io.make('a') });
      await next.load();
      await a.dispose();
      const conflict = createIntentStore(config, { persist: io.make('a'), onError: () => {} });
      await conflict.load();
      expect(conflict.getStatus()).toBe('failed');
      await Promise.all([b.dispose(), next.dispose(), conflict.dispose()]);
    });
  });
}

it('holds ownership until an in-flight native-style write finishes', async () => {
  const io = slowSaveAdapter();
  const first = createIntentStore(config, { persist: io.adapter, now: () => T });
  await first.load();
  first.track('a');
  const save = first.flush();
  const disposing = first.dispose();
  const second = createIntentStore(config, { persist: io.adapter, onError: () => {} });
  await second.load();
  expect(second.getStatus()).toBe('failed');
  io.settle();
  await Promise.all([save, disposing]);
  await second.load();
  expect(second.getState()).toStrictEqual(first.getState());
  await second.dispose();
});

it('releases a late asynchronous acquisition after disposal without reading or writing', async () => {
  let grant!: (release: () => void) => void;
  const release = vi.fn();
  const load = vi.fn(() => null);
  const adapter = {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        grant = resolve;
      }),
    load,
    save: vi.fn(),
  };
  const store = createIntentStore(config, { persist: adapter });
  const loading = store.load();
  const disposing = store.dispose();
  grant(release);
  await Promise.all([loading, disposing]);
  expect(release).toHaveBeenCalledTimes(1);
  expect(load).not.toHaveBeenCalled();
});

it('keeps invalid event validation while snapshotting caller-owned events', () => {
  const store = createIntentStore(config);
  const invalid = Object.assign([], { name: 'a', at: T });
  expect(() => store.observe(invalid)).toThrow(TypeError);
  expect(() => store.observe(null as never)).toThrow(TypeError);
});

// Minimal LockManager implementation: each simulated tab has its own Storage wrapper but shares
// the platform lock service. Completion releases the lock, as the Web Locks contract requires.
function browser() {
  const held = new Set<string>();
  const values = new Map<string, string>();
  const locks = {
    request: async (
      name: string,
      _opts: unknown,
      callback: (lock: object | null) => Promise<void>,
    ) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  vi.stubGlobal('navigator', { locks });
  const tab = () => {
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    return localStorageAdapter('shared', storage);
  };
  return { tab, held };
}

it('uses the browser lock across distinct tab storage wrappers and releases it on disposal', async () => {
  const browserState = browser();
  const first = createIntentStore(config, { persist: browserState.tab() });
  await first.load();
  const second = createIntentStore(config, { persist: browserState.tab(), onError: () => {} });
  await second.load();
  expect(second.getStatus()).toBe('failed');
  expect(browserState.held.size).toBe(1);
  await first.dispose();
  expect(browserState.held.size).toBe(0);
  await second.load();
  expect(second.getStatus()).toBe('loaded');
  await second.dispose();
  expect(browserState.held.size).toBe(0);
});

it('fails safely without Web Locks instead of writing an unprotected browser snapshot', async () => {
  vi.stubGlobal('navigator', {});
  const save = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: save });
  const errors: unknown[] = [];
  const store = createIntentStore(config, {
    persist: localStorageAdapter(),
    onError: (e) => errors.push(e),
  });
  store.track('a');
  await store.flush();
  expect(store.getStatus()).toBe('failed');
  expect(save).not.toHaveBeenCalled();
  expect(String(errors[0])).toContain('Web Locks');
  await store.dispose();
});
