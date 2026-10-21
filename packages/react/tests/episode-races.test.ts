// @vitest-environment node
import assert from 'node:assert/strict';
import {
  createState,
  deserialize,
  type EngineConfig,
  endEpisode,
  observe,
  serialize,
} from 'oracular';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { createIntentStore, type PersistAdapter } from '../src';
import { microtasks, T } from './adapters';

const config: EngineConfig = {
  episodeTimeout: 100,
  learning: { halfLife: 2000 },
  intents: {
    one: {
      prior: 0.2,
      priorStrength: 10,
      halfLife: 1000,
      signals: { a: 3, b: -2 },
      outcome: 'done',
      attribution: 500,
    },
    two: {
      prior: 0.4,
      priorStrength: 5,
      halfLife: 500,
      signals: { b: 4 },
      outcome: 'other',
      episodePerOutcome: true,
    },
  },
};
function rng(seed: number) {
  let value = seed >>> 0;
  return (bound: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) % bound;
  };
}

function controlledAdapter(initial: string) {
  let stored: string | null = initial;
  const reads: {
    json: string | null;
    resolve: (json: string | null) => void;
    reject: (error: Error) => void;
  }[] = [];
  const writes: { json: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  const removals: { resolve: () => void }[] = [];
  let active = 0;
  let started = 0;
  const start = () => {
    active++;
    started++;
    assert.equal(active, 1, 'overlapping storage mutations could complete out of order');
  };
  const adapter: PersistAdapter = {
    load: () => new Promise((resolve, reject) => reads.push({ json: stored, resolve, reject })),
    save: (json) => {
      start();
      return new Promise<void>((resolve, reject) => writes.push({ json, resolve, reject }));
    },
    remove: () => {
      start();
      return new Promise<void>((resolve) => removals.push({ resolve }));
    },
  };
  return {
    adapter,
    reads,
    writes,
    removals,
    stored: () => stored,
    started: () => started,
    completeRead(fail = false) {
      const next = reads.shift();
      if (!next) return;
      if (fail) next.reject(new Error('simulated read failure'));
      else next.resolve(next.json);
    },
    completeWrite(fail = false) {
      const next = writes.shift();
      if (!next) return;
      active--;
      if (fail) next.reject(new Error('simulated write failure'));
      else {
        stored = next.json;
        next.resolve();
      }
    },
    completeRemove() {
      const next = removals.shift();
      if (!next) return;
      active--;
      stored = null;
      next.resolve();
    },
  };
}

describe('cross-episode persistence race stress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('matches serial event processing across 40,000 scheduled actions and delayed, failed storage operations', async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed * 7919);
      let at = T;
      const saved = observe(createState(config), { name: 'a', at: T - 1000 });
      let expected = saved;
      const io = controlledAdapter(serialize(saved));
      const errors: string[] = [];
      const store = createIntentStore(config, {
        persist: io.adapter,
        now: () => at,
        onError: (_error, phase) => errors.push(phase),
      });
      const pending: Promise<void>[] = [];
      let unsettled = 0;
      const track = (promise: Promise<void>) => {
        unsettled++;
        pending.push(
          promise.finally(() => {
            unsettled--;
          }),
        );
      };
      track(store.load());
      for (let step = 0; step < 200; step++) {
        at += [0, 1, 99, 100, 101, 500][random(6)]!;
        const action = random(16);
        if (action < 6) {
          const name = ['a', 'b', 'done', 'other', 'noise', 'done'][action]!;
          store.track(name);
          expected = observe(expected, { name, at });
        } else if (action === 6) {
          store.endEpisode();
          expected = endEpisode(expected, at);
        } else if (action === 7) track(store.flush());
        else if (action === 8) track(store.load());
        else if (action === 9) io.completeRead(random(5) === 0);
        else if (action === 10) io.completeWrite(random(5) === 0);
        else if (action === 11) io.completeRemove();
        else if (action === 12) {
          track(store.clear());
          expected = createState(config);
        } else if (action === 13) await vi.advanceTimersByTimeAsync(250);
        else if (action === 14) await microtasks();
        else {
          const before = serialize(store.getState());
          deserialize(before, { config });
          assert.equal(serialize(store.getState()), before);
        }
        await microtasks();
        if (store.getStatus() === 'loaded')
          assert.deepEqual(store.getState(), expected, `seed=${seed},step=${step}`);
      }
      track(store.flush());
      for (let drain = 0; drain < 500; drain++) {
        io.completeRead();
        io.completeWrite();
        io.completeRemove();
        await microtasks(20);
        if (unsettled === 0 && !io.reads.length && !io.writes.length && !io.removals.length) break;
      }
      assert.equal(
        unsettled,
        0,
        `seed=${seed}/pending=${unsettled}/reads=${io.reads.length}/writes=${io.writes.length}/removals=${io.removals.length}/status=${store.getStatus()}`,
      );
      await Promise.all(pending);
      assert.deepEqual(store.getState(), expected, `seed=${seed}/final memory`);
      const final = store.flush();
      await microtasks();
      io.completeWrite();
      await final;
      const stored = io.stored();
      // A clear with no subsequent event deliberately represents fresh state as an empty key.
      assert.deepEqual(
        stored === null ? createState(config) : deserialize(stored, { config }),
        expected,
        `seed=${seed}/final storage`,
      );
      await store.dispose();
    }
  }, 120_000);

  it('does not let late I/O resurrect disposed state across 1,000 events in consecutive episodes', async () => {
    const saved = observe(createState(config), { name: 'a', at: T - 1000 });
    const io = controlledAdapter(serialize(saved));
    let at = T;
    const store = createIntentStore(config, { persist: io.adapter, now: () => at });
    const load = store.load();
    store.track('b');
    await store.dispose();
    const started = io.started();
    for (let i = 0; i < 1000; i++) {
      at += 101;
      store.track(i % 2 === 0 ? 'a' : 'done');
      store.endEpisode();
    }
    const before = serialize(store.getState());
    io.completeRead();
    await load;
    await store.flush();
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(serialize(store.getState()), before);
    assert.equal(store.getStatus(), 'disposed');
    assert.equal(io.started(), started);
  });

  it('blocks a competing store and preserves history when ownership transfers', async () => {
    let stored: string | null = null;
    const adapter: PersistAdapter = {
      load: () => stored,
      save: (json) => {
        stored = json;
      },
    };
    const first = createIntentStore(config, { persist: adapter, now: () => T });
    const errors: unknown[] = [];
    const second = createIntentStore(config, {
      persist: adapter,
      now: () => T,
      onError: (error) => errors.push(error),
    });
    await Promise.all([first.load(), second.load()]);
    first.track('a');
    first.track('done');
    first.endEpisode();
    await first.flush();
    assert.equal(deserialize(stored!).intents.one!.episodes.hits, 1);
    second.track('b');
    second.endEpisode();
    await second.flush();
    assert.equal(deserialize(stored!).intents.one!.episodes.hits, 1);
    assert.equal(second.getStatus(), 'failed');
    assert.ok(errors.length > 0);
    await first.dispose();
    await second.load();
    await second.flush();
    assert.equal(deserialize(stored!).intents.one!.episodes.hits, 1);
    assert.ok(deserialize(stored!).intents.one!.pending.length > 0);
    assert.equal(first.getState().intents.one!.episodes.hits, 1);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it('replays an observed event as it was when accepted, even if the caller reuses the event object', async () => {
    const saved = observe(createState(config), { name: 'a', at: T });
    const io = controlledAdapter(serialize(saved));
    const store = createIntentStore(config, { persist: io.adapter, now: () => T + 1 });
    const loading = store.load();
    const event = { name: 'done', at: T + 1 };
    store.observe(event);
    const expected = observe(saved, { ...event });
    event.name = 'b';
    event.at = T + 2000;
    io.completeRead();
    await loading;
    assert.deepEqual(store.getState(), expected);
    await store.dispose();
  });
});
