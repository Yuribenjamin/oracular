import { readdirSync, readFileSync } from 'node:fs';
import {
  type DeserializeOptions,
  deserialize,
  type EngineState,
  endEpisode,
  evaluate,
  observe,
  serialize,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { fixtureConfig } from '../scripts/state-fixtures.mjs';
import { assertInvariants } from './helpers';

/**
 * Apps load the state from storage on every launch, and storage can hand back anything: a write
 * cut short, a bit flipped, a value edited by hand. `deserialize` must either throw one of the
 * three documented errors (with an `oracular:` message) or return a state that is sound to use:
 * it passes `assertInvariants`, and reading and updating it never produces NaN or Infinity.
 * Every input is derived from the published-version fixtures with a seeded PRNG, so a failure
 * reproduces exactly.
 */

/** mulberry32: a tiny seeded PRNG, so every run fuzzes exactly the same inputs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixtureDir = new URL('./fixtures/state/', import.meta.url);
/** Distinct fixture texts (versions that wrote identical bytes are fuzzed once), labelled by version. */
const fixtures = (() => {
  const byText = new Map<string, string[]>();
  for (const file of readdirSync(fixtureDir).sort()) {
    const text = readFileSync(new URL(file, fixtureDir), 'utf8');
    byText.set(text, [...(byText.get(text) ?? []), file]);
  }
  return [...byText].map(([text, files]) => ({ file: files.join(' = '), text }));
})();

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = (string | number)[];

/** Placeholders for values JSON.stringify cannot write; swapped into the text afterwards. */
const INF = '@@INF@@';
const NEG_ZERO = '@@NEGZERO@@';
const finish = (text: string) =>
  text.replaceAll(`"${INF}"`, '1e309').replaceAll(`"${NEG_ZERO}"`, '-0');

function deep(depth: number): Json {
  let value: Json = 1;
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

const EVIL: Json[] = [
  null,
  true,
  'x',
  '',
  [],
  {},
  -1,
  0,
  1.5,
  1e308,
  -1e308,
  INF,
  NEG_ZERO,
  deep(64),
  ['pricing.viewed', 'pricing.viewed'],
];

function paths(value: Json, prefix: Path = []): Path[] {
  const out: Path[] = [prefix];
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) out.push(...paths(item, [...prefix, i]));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) out.push(...paths(item, [...prefix, key]));
  }
  return out;
}

function setAt(root: Json, path: Path, value: Json | undefined): Json {
  if (path.length === 0) return value ?? null;
  const copy = structuredClone(root) as Record<string | number, Json>;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, Json>;
  const last = path[path.length - 1]!;
  if (value === undefined) {
    if (Array.isArray(node)) node.splice(last as number, 1);
    else delete node[last];
  } else node[last] = value;
  return copy as Json;
}

/** Adds an own key to every object along a path, including `__proto__`, which JSON can carry. */
function addKey(root: Json, path: Path, key: string, value: Json): Json {
  const copy = structuredClone(root);
  let node = copy as Record<string | number, Json>;
  for (const k of path) node = node[k] as Record<string | number, Json>;
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return copy;
  Object.defineProperty(node, key, { value, enumerable: true, configurable: true, writable: true });
  return copy;
}

/** The app's config one release later: a signal dropped, a new intent added. */
const changedConfig: DeserializeOptions['config'] = {
  ...fixtureConfig,
  intents: {
    upgrade: {
      ...fixtureConfig.intents.upgrade,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'plan.downgraded': -4 },
    },
    checkout: fixtureConfig.intents.checkout,
    churn: {
      prior: 0.1,
      priorStrength: 20,
      halfLife: 14 * 86_400_000,
      signals: { 'cart.emptied': 1 },
    },
  },
};

const ALLOWED = [SyntaxError, TypeError, RangeError];

function finite(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is ${String(value)}`);
  }
}

/** Reads and updates the loaded state the way an app would, and checks every number it sees. */
function assertSound(state: EngineState): void {
  assertInvariants(state);
  const times = [
    state.episode.lastEventAt,
    ...Object.values(state.intents).flatMap((is) => [is.updatedAt, is.learnedAt]),
  ].filter((t): t is number => t !== null);
  const t0 = times.length > 0 ? Math.max(...times) : 1_700_000_000_000;
  for (const name of Object.keys(state.config.intents)) {
    for (const at of [t0, t0 + 1e12]) {
      const { prediction, explanation } = evaluate(state, name, at);
      for (const key of ['p', 'sd', 'lower', 'confidence', 'evidence'] as const) {
        finite(prediction[key], `${name}@${at} prediction.${key}`);
      }
      if (prediction.suppressedUntil !== null) {
        finite(prediction.suppressedUntil, `${name}@${at} suppressedUntil`);
      }
      for (const row of explanation) {
        for (const key of [
          'contribution',
          'impact',
          'initialWeight',
          'learnedWeight',
          'effectiveWeight',
          'hits',
          'misses',
        ] as const) {
          finite(row[key], `${name}@${at} explain ${row.signal}.${key}`);
        }
      }
    }
  }
  let s = state;
  for (const intent of Object.values(state.config.intents)) {
    // One signal for, one against, then the outcome: every kind of update the state can take.
    const weights = Object.entries(intent.signals);
    const picks = [weights.find(([, w]) => w > 0), weights.find(([, w]) => w < 0)];
    for (const pick of picks) {
      if (pick === undefined) continue;
      s = observe(s, { name: pick[0], at: t0 + 1 });
      assertInvariants(s);
    }
    if (intent.outcome !== undefined) {
      s = observe(s, { name: intent.outcome, at: t0 + 2 });
      assertInvariants(s);
    }
  }
  s = endEpisode(s, t0 + 3);
  assertInvariants(s);
}

type Outcome = 'threw' | 'loaded';

/** Runs one input; returns what happened, or a description of the broken property. */
function fuzzOne(text: string, opts?: DeserializeOptions): Outcome | string {
  let state: EngineState;
  try {
    state = deserialize(text, opts);
  } catch (error) {
    if (!ALLOWED.some((E) => error instanceof E)) return `threw ${String(error)}`;
    if (!(error as Error).message.startsWith('oracular:')) {
      return `threw without the oracular: prefix: ${String(error)}`;
    }
    return 'threw';
  }
  try {
    assertSound(state);
  } catch (error) {
    return `loaded an unsound state: ${(error as Error).message.split('\n')[0]}`;
  }
  return 'loaded';
}

function run(cases: Iterable<[string, string]>, opts?: DeserializeOptions) {
  const failures: string[] = [];
  const tally = { threw: 0, loaded: 0 };
  for (const [label, text] of cases) {
    const result = fuzzOne(text, opts);
    if (result === 'threw' || result === 'loaded') tally[result]++;
    else failures.push(`${label}: ${result}`);
  }
  return { failures, tally };
}

function* truncations(text: string): Iterable<[string, string]> {
  for (let i = 0; i < text.length; i++) yield [`truncated at ${i}`, text.slice(0, i)];
}

function* replacements(text: string, only?: (path: Path) => boolean): Iterable<[string, string]> {
  const root = JSON.parse(text) as Json;
  for (const path of paths(root)) {
    if (only !== undefined && !only(path)) continue;
    for (const [i, value] of EVIL.entries()) {
      yield [
        `${JSON.stringify(path)} = evil[${i}]`,
        finish(JSON.stringify(setAt(root, path, value))),
      ];
    }
    if (path.length > 0) {
      yield [`${JSON.stringify(path)} deleted`, JSON.stringify(setAt(root, path, undefined))];
    }
    for (const key of ['__proto__', 'constructor', 'unknown']) {
      yield [
        `${JSON.stringify(path)} + ${key}`,
        JSON.stringify(addKey(root, path, key, { alpha: 1, beta: 1, polluted: true })),
      ];
    }
  }
  for (const version of [0, 2, 3, 4, 5, '1', 1.5, -1, null]) {
    yield [`version ${String(version)}`, JSON.stringify(setAt(root, ['version'], version))];
  }
}

function* scrambles(text: string, seed: number, count: number): Iterable<[string, string]> {
  const random = mulberry32(seed);
  const root = JSON.parse(text) as Json;
  const all = paths(root).filter((p) => p.length > 0);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  for (let i = 0; i < count; i++) {
    // A few values changed at once, the way a hand edit or a buggy writer would.
    let mutated = root;
    const n = 2 + Math.floor(random() * 4);
    for (let k = 0; k < n; k++) {
      const path = pick(all);
      try {
        mutated = setAt(mutated, path, pick(EVIL));
      } catch {
        // The path no longer exists after an earlier change in this case; skip it.
      }
    }
    yield [`seed ${seed} combination ${i}`, finish(JSON.stringify(mutated))];
    // A byte flipped somewhere in the text.
    const at = Math.floor(random() * text.length);
    const char = String.fromCharCode(32 + Math.floor(random() * 95));
    yield [
      `seed ${seed} byte ${at} = ${JSON.stringify(char)}`,
      text.slice(0, at) + char + text.slice(at + 1),
    ];
  }
}

describe('deserialize under corrupt, truncated and tampered input', () => {
  it('has fixtures to start from', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const { text } of fixtures) expect(fuzzOne(text)).toBe('loaded');
  });

  for (const { file, text } of fixtures) {
    it(`${file}: every truncation throws a documented error`, () => {
      const { failures, tally } = run(truncations(text));
      expect(failures).toStrictEqual([]);
      expect(tally.loaded).toBe(0);
    });

    it(`${file}: every single-value tamper throws a documented error or loads soundly`, () => {
      const { failures, tally } = run(replacements(text));
      expect(failures).toStrictEqual([]);
      // Both outcomes must actually occur, or the fuzz is not exercising the parser.
      expect(tally.threw).toBeGreaterThan(0);
      expect(tally.loaded).toBeGreaterThan(0);
    }, 30_000);

    it(`${file}: the same tampers, loaded with a different current config`, () => {
      // The stored config is still parsed, then replaced: tamper with the state, not the snapshot.
      const { failures, tally } = run(
        replacements(text, (path) => path[0] !== 'config'),
        { config: changedConfig },
      );
      expect(failures).toStrictEqual([]);
      expect(tally.loaded).toBeGreaterThan(0);
    }, 30_000);

    it(`${file}: random combinations and byte flips`, () => {
      const seed = [...file].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 7);
      const { failures } = run(scrambles(text, seed, 300));
      expect(failures).toStrictEqual([]);
    }, 30_000);
  }

  it('a state that round-trips through serialize is also fuzz-safe', () => {
    const state = deserialize(fixtures[fixtures.length - 1]!.text, { config: fixtureConfig });
    const text = serialize(state);
    const { failures } = run(scrambles(text, 42, 300));
    expect(failures).toStrictEqual([]);
  }, 30_000);
});
