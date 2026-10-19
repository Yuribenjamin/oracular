import { readdirSync, readFileSync } from 'node:fs';
import {
  createState,
  deserialize,
  type EngineState,
  endEpisode,
  explain,
  markRevealed,
  observe,
  predict,
  STATE_VERSION,
  serialize,
} from 'oracular';
import { describe, expect, it, vi } from 'vitest';
import { fixtureConfig, runScenario, VERSIONS } from '../scripts/state-fixtures.mjs';
import { assertInvariants } from './helpers';

const dir = new URL('./fixtures/state/', import.meta.url);
const read = (version: string) => readFileSync(new URL(`${version}.json`, dir), 'utf8');

/** The state version each published release wrote. Adding a release here is a conscious step. */
const WRITTEN_VERSION: Record<string, number> = {
  '0.1.0': 1,
  '0.1.1': 1,
  '0.1.2': 1,
  '0.2.0': 1,
  '0.2.1': 1,
  '0.3.0': 2,
  '0.4.0': 2,
  '0.5.0': 2,
  '0.5.1': 2,
  '0.5.2': 2,
  '0.6.0': 3,
  '0.7.0': 3,
};

/** The stored state exactly as the old version wrote it. */
type Stored = {
  version: number;
  intents: Record<string, Record<string, unknown> & { alpha: number; beta: number }>;
  episode: {
    startedAt: number | null;
    lastEventAt: number | null;
    intents: Record<string, { seen: string[]; counts?: Record<string, number>; resolved: boolean }>;
  };
};

/** Deep equality that keeps key order and allows 1e-12 on numbers: V8 versions differ by an ulp. */
function expectSameJson(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - expected), path).toBeLessThanOrEqual(
      1e-12 * Math.max(1, Math.abs(expected)),
    );
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const items = actual as unknown[];
    expect(items.length, path).toBe(expected.length);
    for (const [i, item] of expected.entries()) expectSameJson(items[i], item, `${path}[${i}]`);
  } else if (expected !== null && typeof expected === 'object') {
    expect(actual !== null && typeof actual === 'object', path).toBe(true);
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    expect(Object.keys(a), `${path}: keys, in order`).toStrictEqual(Object.keys(e));
    for (const key of Object.keys(e)) expectSameJson(a[key], e[key], `${path}.${key}`);
  } else {
    expect(actual, path).toBe(expected);
  }
}

describe('states saved by every published version', () => {
  it('are what the current build writes for the same scenario, at this state version', () => {
    // No estimate, timestamp or key has moved since the newest release that wrote this version,
    // unless a deliberate change came with a new fixture.
    const newest = [...VERSIONS].reverse().find((v) => WRITTEN_VERSION[v] === STATE_VERSION)!;
    const current = runScenario({ createState, observe, endEpisode, markRevealed, serialize });
    expectSameJson(JSON.parse(current), JSON.parse(read(newest)), newest);
  });

  it('has one fixture per published version, produced by scripts/state-fixtures.mjs', () => {
    expect(readdirSync(dir).sort()).toStrictEqual(VERSIONS.map((v) => `${v}.json`).sort());
    expect(Object.keys(WRITTEN_VERSION).sort()).toStrictEqual([...VERSIONS].sort());
  });

  for (const version of VERSIONS) {
    describe(version, () => {
      const text = read(version);
      const raw = JSON.parse(text) as Stored;

      it('was written as the state version that release used', () => {
        expect(raw.version).toBe(WRITTEN_VERSION[version]);
      });

      it('loads as the current version without a migrate function', () => {
        const migrate = vi.fn();
        const s = deserialize(text, { migrate });
        assertInvariants(s);
        expect(s.version).toBe(STATE_VERSION);
        expect(STATE_VERSION).toBe(3);
        // The library knows every version it ever wrote; the app's migrate is for versions it
        // does not know.
        expect(migrate).not.toHaveBeenCalled();
        // Version 3 holds the episodes waiting under `attribution`; no earlier release had any.
        for (const is of Object.values(s.intents)) expect(is.pending).toStrictEqual([]);
        for (const [name, record] of Object.entries(raw.episode.intents)) {
          // Version 2 counts occurrences per episode. Version 1 only knew which signals were
          // seen, so each counts once; a version 2 state keeps the counts it stored.
          expect(s.episode.intents[name]!.counts).toStrictEqual(
            raw.version === 1
              ? Object.fromEntries(record.seen.map((signal) => [signal, 1]))
              : record.counts,
          );
        }
        expect(Object.values(raw.episode.intents).some((r) => r.seen.length > 0)).toBe(true);
      });

      it('loads, keeping every number it stored', () => {
        const s = deserialize(text);
        assertInvariants(s);
        expect(Object.keys(s.intents).sort()).toStrictEqual(Object.keys(raw.intents).sort());
        for (const [name, stored] of Object.entries(raw.intents)) {
          const is = s.intents[name]!;
          expect(is.alpha).toBeCloseTo(stored.alpha, 9);
          expect(is.beta).toBeCloseTo(stored.beta, 9);
          for (const key of [
            'updatedAt',
            'contributions',
            'learned',
            'episodes',
            'learnedAt',
            'lastRevealedAt',
            'lastOutcomeAt',
            'revealCount',
          ]) {
            expect(is[key as keyof typeof is], `${version} ${name}.${key}`).toStrictEqual(
              stored[key],
            );
          }
          // The estimate an app reads right after the upgrade is the one it read before.
          expect(predict(s, name, stored.updatedAt as number).p).toBeCloseTo(
            stored.alpha / (stored.alpha + stored.beta),
            12,
          );
        }
        expect(s.episode.startedAt).toBe(raw.episode.startedAt);
        expect(s.episode.lastEventAt).toBe(raw.episode.lastEventAt);
        for (const [name, record] of Object.entries(raw.episode.intents)) {
          expect(s.episode.intents[name]!.seen).toStrictEqual(record.seen);
          expect(s.episode.intents[name]!.resolved).toBe(record.resolved);
        }
      });

      it('continues the open episode: a seen signal next counts as its second occurrence', () => {
        const s = deserialize(text, { config: fixtureConfig });
        expect(s.episode.intents.upgrade!.seen).toContain('pricing.viewed');
        const at = s.episode.lastEventAt! + 1_000;
        const row = (state: EngineState) =>
          explain(state, 'upgrade', at).find((r) => r.signal === 'pricing.viewed')!;
        const before = row(s);
        const next = observe(s, { name: 'pricing.viewed', at });
        assertInvariants(next);
        expect(next.episode.intents.upgrade!.counts['pricing.viewed']).toBe(2);
        expect(row(next).contribution - before.contribution).toBeCloseTo(
          before.effectiveWeight * Math.log2(3 / 2),
          12,
        );
      });

      it('loads with the current config and keeps working', () => {
        let s: EngineState = deserialize(text, { config: fixtureConfig });
        assertInvariants(s);
        const at = s.episode.lastEventAt! + 1_000;
        s = observe(s, { name: 'pricing.viewed', at });
        assertInvariants(s);
        s = observe(s, { name: 'checkout.completed', at: at + 1_000 });
        assertInvariants(s);
        s = endEpisode(s, at + 2_000);
        assertInvariants(s);
        const again = deserialize(serialize(s), { config: fixtureConfig });
        assertInvariants(again);
        expect(again).toStrictEqual(s);
      });
    });
  }
});
