import fc from 'fast-check';
import {
  createEndRecord,
  createRecord,
  createState,
  deserialize,
  type EngineConfig,
  type EngineState,
  endEpisode,
  evaluate,
  evidenceToReveal,
  explain,
  type IntentConfig,
  inspect,
  markRevealed,
  observe,
  predict,
  type RevealOptions,
  serialize,
  shouldReveal,
  validateConfig,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { LIFT_TYPES } from '../src/config';
import { decayIntent, priorCounts } from '../src/intent';
import { assertInvariants, clone, DAY, deepFreeze, HOUR, MINUTE } from './helpers';

// Generated configs and event traces, checked against the properties the stability page names.
// The seed is fixed so every run is reproducible; `PROPERTY_SEED=<n> npm test` explores another
// one. On a failure fast-check prints the seed and the shrunk counterexample.
fc.configureGlobal({
  numRuns: 200,
  seed: Number(process.env.PROPERTY_SEED ?? 20261019),
});

const T = 1_700_000_000_000;
const INTENTS = ['i0', 'i1', 'i2', 'i3'];
const SIGNALS = ['s0', 's1', 's2', 's3', 's4', 's5'];
const OUTCOME = 'done';
// 'constructor' is the own-property hazard: it exists on Object.prototype.
const EVENTS = [...SIGNALS, OUTCOME, 'noise', 'constructor'];

// Grids rather than fc.double over a range: fc.double is uniform over the representable floats,
// so most weights would be vanishingly small. Priors in hundredths, weights in tenths, strengths
// and learning knobs in halves, durations from a list of round values or any integer.
const weight = fc
  .integer({ min: -50, max: 50 })
  .filter((n) => n !== 0)
  .map((n) => n / 10);
const halfLife = fc.oneof(
  fc.constantFrom(1e3, MINUTE, HOUR, DAY, 7 * DAY, 1e9),
  fc.integer({ min: 1e3, max: 1e9 }),
);
const episodeTimeout = fc.oneof(
  fc.constantFrom(MINUTE, 30 * MINUTE, HOUR, DAY),
  fc.integer({ min: 1e3, max: 1e8 }),
);

const reveal = fc.record(
  {
    threshold: fc.integer({ min: 1, max: 9 }).map((n) => n / 10),
    z: fc.constantFrom(0, 0.5, 1.28, 1.64, 2, 3),
    cooldown: fc.constantFrom(0, MINUTE, HOUR, DAY),
    outcomeCooldown: fc.constantFrom(0, MINUTE, HOUR, DAY),
    bound: fc.constantFrom('normal' as const, 'exact' as const),
  },
  { requiredKeys: [], noNullPrototype: true },
);

const intent: fc.Arbitrary<IntentConfig> = fc.record(
  {
    prior: fc.integer({ min: 1, max: 99 }).map((n) => n / 100),
    priorStrength: fc.integer({ min: 2, max: 200 }).map((n) => n / 2),
    halfLife,
    signals: fc.dictionary(fc.constantFrom(...SIGNALS), weight, {
      minKeys: 1,
      maxKeys: 6,
      noNullPrototype: true,
    }),
    outcome: fc.constant(OUTCOME),
    resetOnOutcome: fc.boolean(),
    saturate: fc.boolean(),
    episodePerOutcome: fc.boolean(),
    attribution: fc.oneof(fc.constantFrom(HOUR, DAY, 7 * DAY), fc.integer({ min: 1e3, max: 1e9 })),
    reveal,
  },
  { requiredKeys: ['prior', 'priorStrength', 'halfLife', 'signals'], noNullPrototype: true },
);

const config: fc.Arbitrary<EngineConfig> = fc.record(
  {
    intents: fc.dictionary(fc.constantFrom(...INTENTS), intent, {
      minKeys: 1,
      maxKeys: 4,
      noNullPrototype: true,
    }),
    episodeTimeout,
    learning: fc.record(
      {
        halfLife,
        lift: fc.constantFrom(...LIFT_TYPES),
        gain: fc.integer({ min: 1, max: 10 }).map((n) => n / 2),
        priorEpisodes: fc.integer({ min: 1, max: 40 }).map((n) => n / 2),
      },
      { requiredKeys: [], noNullPrototype: true },
    ),
    reveal,
  },
  { requiredKeys: ['intents'], noNullPrototype: true },
);

type Step =
  | { kind: 'observe'; name: string; gap: number }
  | { kind: 'end'; gap: number }
  | { kind: 'reveal'; pick: number; gap: number };

// Mostly forward gaps of every scale; one step in ten jumps backwards, which the engine tolerates.
const gap = fc.oneof(
  { weight: 9, arbitrary: fc.constantFrom(0, 1, MINUTE, HOUR, 3 * DAY, 60 * DAY) },
  { weight: 1, arbitrary: fc.constantFrom(-MINUTE, -2 * DAY) },
);
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 18,
    arbitrary: fc.record({
      kind: fc.constant('observe' as const),
      name: fc.constantFrom(...EVENTS),
      gap,
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('end' as const), gap }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('reveal' as const), pick: fc.nat(3), gap }),
  },
);
const trace = fc.array(step, { maxLength: 60 });
const scenario = fc.record({ config, trace });
const options = fc.option(reveal, { nil: undefined });
const delay = fc.constantFrom(0, 1, MINUTE, HOUR, DAY, 30 * DAY, 365 * DAY);

interface Run {
  states: EngineState[];
  final: EngineState;
  lastAt: number;
}

/** Applies a trace, checking the invariants after every operation; `read` runs after each step. */
function run(
  cfg: EngineConfig,
  steps: readonly Step[],
  read?: (state: EngineState, at: number) => void,
): Run {
  const names = Object.keys(cfg.intents);
  let s = createState(cfg);
  assertInvariants(s);
  const states = [s];
  let at = T;
  for (const current of steps) {
    at += current.gap;
    if (current.kind === 'observe') s = observe(s, { name: current.name, at });
    else if (current.kind === 'end') s = endEpisode(s, at);
    else s = markRevealed(s, names[current.pick % names.length]!, at);
    assertInvariants(s);
    states.push(s);
    read?.(s, at);
  }
  return { states, final: s, lastAt: at };
}

/** Freezes the arguments, calls twice, and checks both results agree and the inputs are untouched. */
function pure<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R {
  deepFreeze(args);
  const before = clone(args);
  const first = fn(...args);
  const second = fn(...args);
  expect(second).toStrictEqual(first);
  expect(args).toStrictEqual(before);
  return first;
}

/** The threshold `shouldReveal` uses: call → intent → engine → default. */
function thresholdFor(cfg: EngineConfig, name: string, opts: RevealOptions | undefined): number {
  return opts?.threshold ?? cfg.intents[name]?.reveal?.threshold ?? cfg.reveal?.threshold ?? 0.5;
}

describe('properties', () => {
  it('purity: no public function mutates its input, and calling it twice gives the same answer', () => {
    fc.assert(
      fc.property(scenario, options, ({ config: cfg, trace: steps }, opts) => {
        const { final: s, lastAt } = run(cfg, steps);
        const name = Object.keys(cfg.intents)[0]!;
        const at = lastAt + HOUR;
        pure(validateConfig, cfg);
        const fresh = pure(createState, cfg);
        pure(observe, fresh, { name: 's0', at: T, props: { nested: [1] } });
        pure(endEpisode, s, at);
        pure(markRevealed, s, name, at);
        pure(predict, s, name, at, opts);
        pure(shouldReveal, s, name, at, opts);
        pure(explain, s, name, at, { nonZero: true });
        pure(evaluate, s, name, at, { ...opts, limit: 2 });
        pure(inspect, s, at, opts);
        pure(evidenceToReveal, cfg.intents[name]!, opts);
        const json = pure(serialize, s);
        pure(deserialize, json);
        pure(deserialize, json, { config: cfg });
        const event = { name: 's1', at };
        pure(createRecord, pure(observe, s, event), event, {
          installId: 'install',
          mode: 'shadow',
        });
        pure(createEndRecord, at, { installId: 'install', mode: 'live', top: 1 });
      }),
    );
  });

  it('monotone decay: with no events, p drifts toward the prior and evidence toward the prior strength', () => {
    fc.assert(
      fc.property(scenario, delay, delay, ({ config: cfg, trace: steps }, d1, d2) => {
        const { final: s, lastAt } = run(cfg, steps);
        for (const [name, ic] of Object.entries(cfg.intents)) {
          const updatedAt = s.intents[name]!.updatedAt ?? lastAt;
          const anchor = Math.max(lastAt, updatedAt);
          const [t1, t2] = d1 <= d2 ? [anchor + d1, anchor + d2] : [anchor + d2, anchor + d1];
          const earlier = predict(s, name, t1);
          const later = predict(s, name, t2);
          expect(Math.abs(later.p - ic.prior)).toBeLessThanOrEqual(
            Math.abs(earlier.p - ic.prior) + 1e-12,
          );
          expect(later.evidence).toBeLessThanOrEqual(earlier.evidence + 1e-9);
          expect(later.evidence).toBeGreaterThanOrEqual(ic.priorStrength - 1e-9);
          // A clock that runs backwards does not decay: before the anchor, the estimate is the
          // one at the anchor.
          const back = predict(s, name, updatedAt - HOUR);
          const now = predict(s, name, updatedAt);
          for (const key of ['p', 'sd', 'lower', 'confidence', 'evidence'] as const) {
            expect(back[key]).toBe(now[key]);
          }
        }
      }),
    );
  });

  it('α/β invariant: α = α₀ + Σ contributions.alpha and β = β₀ + Σ contributions.beta after every operation', () => {
    fc.assert(
      fc.property(scenario, ({ config: cfg, trace: steps }) => {
        // run() calls assertInvariants after every operation; this spells the sums out.
        const { states } = run(cfg, steps);
        for (const s of states) {
          for (const [name, ic] of Object.entries(s.config.intents)) {
            const is = s.intents[name]!;
            const { alpha0, beta0 } = priorCounts(ic);
            let sumAlpha = 0;
            let sumBeta = 0;
            for (const c of Object.values(is.contributions)) {
              expect(c.alpha).toBeGreaterThanOrEqual(0);
              expect(c.beta).toBeGreaterThanOrEqual(0);
              sumAlpha += c.alpha;
              sumBeta += c.beta;
            }
            expect(is.alpha - alpha0).toBeCloseTo(sumAlpha, 9);
            expect(is.beta - beta0).toBeCloseTo(sumBeta, 9);
          }
        }
        // While no episode closes and no outcome arrives, nothing is learned, so every signal's
        // evidence sits on the side its configured sign says: positive weights in α, negative in β.
        const { episodeTimeout: _timeout, ...open } = cfg;
        const quiet = steps.filter(
          (s) => s.kind !== 'end' && !(s.kind === 'observe' && s.name === OUTCOME),
        );
        const { final } = run(open, quiet);
        for (const [name, ic] of Object.entries(final.config.intents)) {
          for (const [signal, c] of Object.entries(final.intents[name]!.contributions)) {
            if (ic.signals[signal]! > 0) expect(c.beta).toBe(0);
            else expect(c.alpha).toBe(0);
          }
        }
      }),
    );
  });

  it('serialize/deserialize identity: the loaded state equals the saved one and answers every read the same', () => {
    fc.assert(
      fc.property(scenario, options, ({ config: cfg, trace: steps }, opts) => {
        const { final: s, lastAt } = run(cfg, steps);
        const json = serialize(s);
        for (const loaded of [deserialize(json), deserialize(json, { config: cfg })]) {
          assertInvariants(loaded);
          expect(loaded).toStrictEqual(s);
          // Byte for byte on the first pass: an app that skips a save when the string has not
          // changed must not write once after every load.
          expect(serialize(loaded)).toBe(json);
          for (const name of Object.keys(cfg.intents)) {
            for (const at of [lastAt, lastAt + HOUR, lastAt + 30 * DAY]) {
              expect(predict(loaded, name, at, opts)).toStrictEqual(predict(s, name, at, opts));
              expect(shouldReveal(loaded, name, at, opts)).toBe(shouldReveal(s, name, at, opts));
              expect(explain(loaded, name, at)).toStrictEqual(explain(s, name, at));
              expect(evaluate(loaded, name, at, opts)).toStrictEqual(evaluate(s, name, at, opts));
            }
          }
        }
      }),
    );
  });

  it('shouldReveal ⇔ no cooldown running and p ≥ threshold and lower ≥ threshold', () => {
    fc.assert(
      fc.property(scenario, options, delay, ({ config: cfg, trace: steps }, opts, d) => {
        const { final: s, lastAt } = run(cfg, steps);
        const at = lastAt + d;
        for (const name of Object.keys(cfg.intents)) {
          const threshold = thresholdFor(cfg, name, opts);
          const pr = predict(s, name, at, opts);
          const gate = pr.suppressedUntil === null && pr.p >= threshold && pr.lower >= threshold;
          expect(shouldReveal(s, name, at, opts)).toBe(gate);
          expect(evaluate(s, name, at, opts).reveal).toBe(gate);
        }
      }),
    );
  });

  it('predict stays in [0, 1]; explain lists every signal once, in impact order, with contributions summing to (α − α₀) − (β − β₀)', () => {
    fc.assert(
      fc.property(scenario, delay, ({ config: cfg, trace: steps }, d) => {
        const { final: s, lastAt } = run(cfg, steps);
        const at = lastAt + d;
        for (const [name, ic] of Object.entries(s.config.intents)) {
          const pr = predict(s, name, at);
          for (const key of ['p', 'sd', 'lower', 'confidence'] as const) {
            expect(Number.isFinite(pr[key]), `${key} finite`).toBe(true);
            expect(pr[key]).toBeGreaterThanOrEqual(0);
            expect(pr[key]).toBeLessThanOrEqual(1);
          }
          expect(pr.evidence).toBeGreaterThanOrEqual(ic.priorStrength - 1e-9);

          const rows = explain(s, name, at);
          expect(rows.map((r) => r.signal).sort()).toStrictEqual(Object.keys(ic.signals).sort());
          for (let i = 1; i < rows.length; i++) {
            const a = rows[i - 1]!;
            const b = rows[i]!;
            const ordered =
              Math.abs(a.impact) > Math.abs(b.impact) ||
              (Math.abs(a.impact) === Math.abs(b.impact) && a.signal < b.signal);
            expect(ordered, `${a.signal} before ${b.signal}`).toBe(true);
          }
          const is = decayIntent(s.intents[name]!, ic, at);
          const { alpha0, beta0 } = priorCounts(ic);
          const sum = rows.reduce((acc, r) => acc + r.contribution, 0);
          expect(sum).toBeCloseTo(is.alpha - alpha0 - (is.beta - beta0), 9);
        }
      }),
    );
  });

  it('reads leave no trace: interleaving every read-only function between operations changes nothing', () => {
    fc.assert(
      fc.property(scenario, options, ({ config: cfg, trace: steps }, opts) => {
        const plain = run(cfg, steps);
        const names = Object.keys(cfg.intents);
        for (const name of names) evidenceToReveal(cfg.intents[name]!, opts);
        const read = (s: EngineState, at: number) => {
          for (const name of names) {
            predict(s, name, at, opts);
            shouldReveal(s, name, at, opts);
            explain(s, name, at, { limit: 2 });
            evaluate(s, name, at, opts);
          }
          inspect(s, at, opts);
          serialize(s);
          createRecord(s, { name: 'noise', at }, { installId: 'install', mode: 'shadow' });
        };
        const observed = run(cfg, steps, read);
        expect(observed.final).toStrictEqual(plain.final);
        expect(serialize(observed.final)).toBe(serialize(plain.final));
        expect(observed.states).toStrictEqual(plain.states);
      }),
    );
  });
});
