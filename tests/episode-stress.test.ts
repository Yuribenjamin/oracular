import assert from 'node:assert/strict';
import {
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode,
  observe,
  predict,
  serialize,
} from 'oracular';
import { describe, it } from 'vitest';

const T = 1_700_000_000_000;
const timeout = 100;
const signals = ['a', 'b', 'negative'];
function config(attempts = false, attribution?: number): EngineConfig {
  return {
    episodeTimeout: timeout,
    intents: {
      one: {
        prior: 0.2,
        priorStrength: 10,
        halfLife: 1000,
        signals: { a: 3, b: 2, negative: -2 },
        outcome: 'done',
        episodePerOutcome: attempts,
        ...(attribution === undefined ? {} : { attribution }),
      },
      two: {
        prior: 0.4,
        priorStrength: 5,
        halfLife: 500,
        signals: { a: -1, b: 4, negative: 1 },
        outcome: 'other',
        episodePerOutcome: !attempts,
        ...(attribution === undefined ? {} : { attribution: attribution * 2 }),
      },
    },
  };
}

// Independent ledger: one immutable verdict per completed attempt/session, with a separate
// collection of unresolved sessions. No engine helper is used to compute expected accounting.
class Ledger {
  seen = new Set<string>();
  resolved = false;
  pending: { end: number; seen: string[] }[] = [];
  hits = 0;
  misses = 0;
  learned = Object.fromEntries(signals.map((s) => [s, { hits: 0, misses: 0 }]));
  constructor(
    readonly attempts: boolean,
    readonly window: number | undefined,
  ) {}
  verdict(seen: Iterable<string>, credit: number) {
    this.hits += credit;
    this.misses += 1 - credit;
    for (const s of seen) {
      this.learned[s]!.hits += credit;
      this.learned[s]!.misses += 1 - credit;
    }
  }
  expire(at: number) {
    while (this.pending.length && this.pending[0]!.end + (this.window ?? 0) < at) {
      this.verdict(this.pending.shift()!.seen, 0);
    }
  }
  close(at: number) {
    if (!this.resolved || (this.attempts && this.seen.size)) {
      this.expire(at);
      if (this.window === undefined) this.verdict(this.seen, 0);
      else {
        this.pending.push({ end: at, seen: [...this.seen] });
        if (this.pending.length > 32) this.verdict(this.pending.shift()!.seen, 0);
      }
    }
    this.seen.clear();
    this.resolved = false;
  }
  event(name: string, outcome: string, halfLife: number, at: number) {
    if (!signals.includes(name) && name !== outcome) return;
    this.expire(at);
    if (signals.includes(name)) this.seen.add(name);
    if (name !== outcome) return;
    if (!this.resolved || this.seen.size || this.attempts) this.verdict(this.seen, 1);
    for (const p of this.pending) this.verdict(p.seen, 2 ** (-(at - p.end) / halfLife));
    this.pending = [];
    this.seen.clear();
    this.resolved = true;
  }
}

function closeEnough(actual: number, expected: number, context: string) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${context}: ${actual} != ${expected}`,
  );
}
function check(state: EngineState, ledgers: Ledger[], context: string) {
  for (const [i, name] of ['one', 'two'].entries()) {
    const actual = state.intents[name]!;
    const expected = ledgers[i]!;
    closeEnough(actual.episodes.hits, expected.hits, `${context}/${name}/hits`);
    closeEnough(actual.episodes.misses, expected.misses, `${context}/${name}/misses`);
    assert.equal(actual.pending.length, expected.pending.length, `${context}/${name}/pending`);
    for (const s of signals) {
      closeEnough(
        actual.learned[s]?.hits ?? 0,
        expected.learned[s]!.hits,
        `${context}/${name}/${s}/hits`,
      );
      closeEnough(
        actual.learned[s]?.misses ?? 0,
        expected.learned[s]!.misses,
        `${context}/${name}/${s}/misses`,
      );
    }
  }
}
function rng(seed: number) {
  let value = seed >>> 0;
  return (bound: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) % bound;
  };
}

const actions = ['a', 'b', 'negative', 'done', 'other', 'noise', 'end'] as const;
const gaps = [0, 0, 1, 99, 100, 101, 200, 400];
function run(seed: number, length: number, attempts: boolean, attribution?: number) {
  const random = rng(seed);
  const cfg = config(attempts, attribution);
  let state = createState(cfg);
  let last: number | null = null;
  let at = T;
  const ledgers = [
    new Ledger(attempts, attribution),
    new Ledger(!attempts, attribution === undefined ? undefined : attribution * 2),
  ];
  for (let step = 0; step < length; step++) {
    at += gaps[random(gaps.length)]!;
    const action = actions[random(actions.length)]!;
    const context = `seed=${seed},step=${step},action=${action},attempts=${attempts},attribution=${attribution}`;
    const close = (end: number) => {
      for (const ledger of ledgers) ledger.close(end);
      last = null;
    };
    if (action === 'end') {
      if (last !== null) close(at - last > timeout ? last + timeout : at);
      state = endEpisode(state, at);
      assert.equal(endEpisode(state, at), state, `${context}/duplicate-close`);
    } else {
      if (last !== null && at - last > timeout) close(last + timeout);
      ledgers[0]!.event(action, 'done', 1000, at);
      ledgers[1]!.event(action, 'other', 500, at);
      last = at;
      state = observe(state, { name: action, at });
    }
    check(state, ledgers, context);
    if (step % 100 === 0) {
      const restored = deserialize(serialize(state), { config: cfg });
      assert.deepEqual(restored, state, `${context}/restore`);
      state = restored;
      for (const name of ['one', 'two']) {
        const p = predict(state, name, at);
        assert.ok(Number.isFinite(p.p) && p.p >= 0 && p.p <= 1, `${context}/prediction`);
      }
    }
  }
}

describe('episode stress against an independent accounting ledger', () => {
  it('replays 300,000 actions through same-time races, idle boundaries, duplicate outcomes, and delayed attribution', () => {
    for (const attempts of [false, true]) {
      for (const attribution of [undefined, 100, 100_000]) {
        for (let seed = 1; seed <= 50; seed++) run(seed, 1000, attempts, attribution);
      }
    }
  }, 120_000);

  it('survives 100,000 actions with clock glitches, corrections, learning decay and restarts', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = rng(seed * 7919);
      const cfg = { ...config(seed % 2 === 0, 1000), learning: { halfLife: 1000 } };
      let state = createState(cfg);
      let at = T;
      for (let step = 0; step < 1000; step++) {
        at += [0, 1, 100, 101, -50, -10_000, 50_000][random(7)]!;
        const action = actions[random(actions.length)]!;
        state = action === 'end' ? endEpisode(state, at) : observe(state, { name: action, at });
        for (const [name, value] of Object.entries(state.intents)) {
          assert.ok(Number.isFinite(value.alpha) && value.alpha > 0);
          assert.ok(Number.isFinite(value.beta) && value.beta > 0);
          for (const r of [value.episodes, ...Object.values(value.learned)]) {
            assert.ok(
              Number.isFinite(r.hits) && r.hits >= 0,
              `seed=${seed}/step=${step}/${name}/hits`,
            );
            assert.ok(
              Number.isFinite(r.misses) && r.misses >= 0,
              `seed=${seed}/step=${step}/${name}/misses`,
            );
          }
          assert.ok(value.pending.length <= 32);
          const p = predict(state, name, at);
          assert.ok(Number.isFinite(p.p) && p.p >= 0 && p.p <= 1);
          assert.ok(Number.isFinite(p.lower) && p.lower >= 0 && p.lower <= 1);
        }
        if (step % 25 === 0) {
          assert.deepEqual(
            deserialize(serialize(state), { config: cfg }),
            state,
            `seed=${seed}/step=${step}/restore`,
          );
        }
      }
    }
  }, 120_000);
});
