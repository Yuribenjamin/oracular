import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createState,
  type EngineConfig,
  endEpisode,
  explain,
  type LiftType,
  observe,
  type RecordMode,
  validateConfig,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../cli/log';
import { replay } from '../cli/replay';
import { run } from '../cli/run';
import {
  DEFAULT_HALF_LIVES,
  DEFAULT_PRIOR_EPISODES,
  FLAT_GRID_GAIN,
  MIN_INSTALLS_FOR_SPREAD,
  STRENGTH_RANGE,
  tune,
  UBIQUITY_SHARE,
  wilson,
} from '../cli/tune';
import { formatTuneText } from '../cli/tune-report';
import { LIFT_TYPES } from '../src/config';
import { DAY, deepFreeze, MINUTE } from './helpers';

const root = fileURLToPath(new URL('../', import.meta.url));
const T = 1_700_000_000_000;

const ev = (
  installId: string,
  at: number,
  name: string,
  mode: RecordMode = 'shadow',
): LogEntry => ({
  kind: 'event',
  installId,
  mode,
  name,
  at,
});
const end = (installId: string, at: number, mode: RecordMode = 'shadow'): LogEntry => ({
  kind: 'end',
  installId,
  mode,
  at,
});

// ---- a log small enough to count by hand ----

/**
 * Install a: episode 1 has x and the outcome; episode 2 has x and ends; episode 3 has y and ends.
 * Install b: episode 1 has x, y and the outcome; episode 2 has an event of no intent and ends.
 * Pooled: x seen in 3 episodes (2 hits, 1 miss), y in 2 (1 hit, 1 miss); 5 episodes, 2 outcomes.
 */
const buyConfig: EngineConfig = {
  intents: {
    buy: {
      prior: 0.3,
      priorStrength: 2,
      halfLife: 1e15,
      signals: { x: 3, y: 1 },
      outcome: 'buy.done',
      saturate: false,
      reveal: { cooldown: 100 },
    },
  },
};

const handLog = (mode: RecordMode = 'shadow'): LogEntry[] => [
  ev('a', T, 'x'),
  ev('a', T + 10, 'buy.done'),
  end('a', T + 20),
  ev('a', T + 1000, 'x'),
  end('a', T + 1010),
  ev('a', T + 2000, 'y'),
  end('a', T + 2010),
  ev('b', T, 'x', mode),
  ev('b', T + 5, 'y', mode),
  ev('b', T + 10, 'buy.done', mode),
  end('b', T + 20, mode),
  ev('b', T + 1000, 'z'),
  end('b', T + 1010),
];

describe('tune, on a log small enough to count by hand', () => {
  const report = tune(deepFreeze(handLog()), buyConfig, { halfLives: [1e15] });
  const [fit] = report.intents;

  // x: 2 hits, 1 miss; 2 episodes without it, none with the outcome; base rate 2 of 5. Shrunk
  // toward 0.4 by two pseudo-episodes: qWith = (2 + 0.8) / 5 = 0.56, qWithout = (0 + 0.8) / 4 = 0.2.
  const qWith = (2 + 2 * 0.4) / 5;
  const qWithout = (0 + 2 * 0.4) / 4;
  const oddsRatio = qWith / (1 - qWith) / (qWithout / (1 - qWithout));
  it.each<[LiftType, number, number]>([
    ['absolute-difference', qWith - qWithout, qWith - qWithout],
    ['relative-lift', (qWith - qWithout) / qWithout, 1.8 / 2.8],
    ['risk-ratio', qWith / qWithout, 1.8 / 3.8],
    ['log-lift', Math.log(qWith / qWithout), Math.log(2.8) / (1 + Math.log(2.8))],
    ['odds-ratio', oddsRatio, (oddsRatio - 1) / (oddsRatio + 1)],
    ['normalized-difference', (qWith - qWithout) / (1 - qWithout), 0.36 / 0.8],
    ['association-rule', qWith / 0.4, 0.4 / 2.4],
  ])('reports raw %s and fits its signed evidence score', (lift, expected, score) => {
    const config = { ...buyConfig, learning: { lift } };
    const selected = tune(handLog(), config, { halfLives: [1e15], allEvents: true });
    const x = selected.intents[0]!.signals.find((s) => s.signal === 'x')!;
    expect(x.lift).toBeCloseTo(expected, 12);
    expect(x.score).toBeCloseTo(score, 12);
    expect(x.weight).toBe(Math.round(2 * score * 100) / 100);
    expect(Number.isFinite(x.low)).toBe(true);
    expect(Number.isFinite(x.high)).toBe(true);
    expect(selected.config.learning?.lift).toBe(lift);
    expect(() => validateConfig(selected.config)).not.toThrow();
  });

  it('scales a bounded score even at the maximum configured prior strength', () => {
    const config: EngineConfig = {
      ...buyConfig,
      learning: { lift: 'odds-ratio' },
      intents: { buy: { ...buyConfig.intents.buy!, priorStrength: 1e6 } },
    };
    const selected = tune(handLog(), config, { halfLives: [1e15] });
    const x = selected.intents[0]!.signals.find((s) => s.signal === 'x')!;
    expect(x.lift).toBeCloseTo(oddsRatio, 12);
    expect(x.score).toBeCloseTo((oddsRatio - 1) / (oddsRatio + 1), 12);
    expect(x.weight).toBe(671641.79);
    expect(x.low).toBeGreaterThanOrEqual(-1e6);
    expect(x.high).toBeLessThanOrEqual(1e6);
    expect(() => validateConfig(selected.config)).not.toThrow();
  });

  it('pools the engine’s own hits, misses and episode totals across installs', () => {
    expect(report.installs).toBe(2);
    expect(report.skipped).toStrictEqual([]);
    expect(fit?.installs).toBe(2);
    expect(fit?.episodes).toBe(5);
    expect(fit?.outcomes).toBe(2);
    expect(fit?.excluded).toBe(0);
    const [x, y] = fit?.signals ?? [];
    expect([x?.hits, x?.misses, x?.without, x?.outcomesWithout]).toStrictEqual([2, 1, 2, 0]);
    expect([y?.hits, y?.misses, y?.without, y?.outcomesWithout]).toStrictEqual([1, 1, 3, 1]);
  });

  it('smooths the base rate into the prior', () => {
    expect(fit?.prior.value).toBeCloseTo(3 / 7, 12);
    expect(fit?.prior.current).toBe(0.3);
    expect(report.config.intents.buy?.prior).toBe(0.4286);
  });

  it('keeps the prior strength below ten installs, and says so', () => {
    expect(fit?.priorStrength).toStrictEqual({
      value: 2,
      current: 2,
      source: 'kept',
      note: 'kept: 2 installs with a counted episode, reading the spread needs 10',
    });
  });

  it('weights each signal by priorStrength × the engine’s lift over episodes without it', () => {
    const [x, y] = fit?.signals ?? [];
    // Base rate 2 of 5; both rates shrunk toward it by two pseudo-episodes.
    // x: qWith (2+0.8)/(3+2) = 0.56, qWithout (0+0.8)/(2+2) = 0.2, lift 0.36/0.8.
    expect(x?.qWith).toBeCloseTo(0.56, 12);
    expect(x?.qWithout).toBeCloseTo(0.2, 12);
    expect(x?.lift).toBeCloseTo(0.36 / 0.8, 12);
    expect(x?.weight).toBe(0.9);
    expect(x?.contrast).toBeCloseTo(1.2, 12);
    expect(x?.thin).toBe(true);
    // y: qWith (1+0.8)/(2+2) = 0.45, qWithout (1+0.8)/(3+2) = 0.36, lift 0.09/0.64.
    expect(y?.qWith).toBeCloseTo(0.45, 12);
    expect(y?.qWithout).toBeCloseTo(0.36, 12);
    expect(y?.lift).toBeCloseTo(0.09 / 0.64, 12);
    expect(y?.weight).toBe(0.28);
    for (const f of [x, y]) {
      expect(f?.low).toBeLessThanOrEqual(f?.weight as number);
      expect(f?.high).toBeGreaterThanOrEqual(f?.weight as number);
      expect(f?.current).toBe(buyConfig.intents.buy?.signals[f?.signal as string]);
    }
  });

  it('writes the fitted values into the config it started from and nothing else', () => {
    expect(report.config).toStrictEqual(
      createState({
        intents: {
          buy: { ...buyConfig.intents.buy, prior: 0.4286, signals: { x: 0.9, y: 0.28 } },
        },
      } as EngineConfig).config,
    );
    expect(() => validateConfig(report.config)).not.toThrow();
  });

  it('keeps a half-life grid of one point', () => {
    expect(fit?.halfLife.value).toBe(1e15);
    expect(fit?.halfLife.source).toBe('grid');
    expect(fit?.halfLife.window).toBe(100);
    expect(fit?.halfLife.curve.map((p) => p.halfLife)).toStrictEqual([1e15]);
  });

  it('is deterministic and leaves its inputs alone', () => {
    const entries = deepFreeze(handLog());
    const config = deepFreeze(structuredClone(buyConfig));
    expect(tune(entries, config, { halfLives: [1e15] })).toStrictEqual(report);
  });

  it('leaves out an episode in which a reveal was live, unless told to count it', () => {
    const mixed = tune(handLog('live'), buyConfig, { halfLives: [1e15] });
    const [f] = mixed.intents;
    expect(mixed.scored).toBe('shadow');
    expect(mixed.mixedInstalls).toBe(1);
    expect([f?.episodes, f?.outcomes, f?.excluded]).toStrictEqual([4, 1, 1]);
    const [x, y] = f?.signals ?? [];
    expect([x?.hits, x?.misses]).toStrictEqual([1, 1]);
    expect([y?.hits, y?.misses]).toStrictEqual([0, 1]);

    const all = tune(handLog('live'), buyConfig, { halfLives: [1e15], includeLive: true });
    expect(all.scored).toBe('all');
    expect(all.intents[0]?.excluded).toBe(0);
    expect(all.intents.map((i) => ({ ...i }))).toStrictEqual(report.intents.map((i) => ({ ...i })));
  });

  it('skips intents without an outcome and refuses unknown ones', () => {
    const config: EngineConfig = {
      intents: {
        ...buyConfig.intents,
        tip: { prior: 0.2, priorStrength: 5, halfLife: DAY, signals: { 'app.opened': 1 } },
      },
    };
    const r = tune(handLog(), config, { halfLives: [1e15] });
    expect(r.intents.map((i) => i.intent)).toStrictEqual(['buy']);
    expect(r.skipped).toStrictEqual([
      { intent: 'tip', reason: 'declares no outcome event, so there is nothing to fit' },
    ]);
    expect(r.config.intents.tip).toStrictEqual(createState(config).config.intents.tip);
    expect(() => tune(handLog(), config, { intents: ['nope'] })).toThrow(RangeError);
  });

  it('scores an intent with no cooldown over its half-life, unless a window is given', () => {
    const noCooldown: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy, reveal: { cooldown: 0 } } as never },
    };
    expect(tune(handLog(), noCooldown, { halfLives: [1e15] }).intents[0]?.halfLife).toMatchObject({
      window: buyConfig.intents.buy!.halfLife,
      windowSource: 'halfLife',
    });
    expect(tune(handLog(), buyConfig, { halfLives: [1e15] }).intents[0]?.halfLife).toMatchObject({
      window: 100,
      windowSource: 'cooldown',
    });
    expect(
      tune(handLog(), noCooldown, { window: 100, halfLives: [1e15] }).intents[0]?.halfLife,
    ).toMatchObject({ window: 100, windowSource: 'option' });
    expect(() => tune(handLog(), noCooldown, { window: 0 })).toThrow(RangeError);
  });

  it('reports a candidate for every other event name with --all-events, and never adds it to the config', () => {
    const r = tune(handLog(), buyConfig, { halfLives: [1e15], allEvents: true });
    const [f] = r.intents;
    expect(f?.candidates.map((c) => c.signal)).toStrictEqual(['z']);
    const [z] = f?.candidates ?? [];
    // z was seen once, in install b's second episode, which ended without the outcome.
    expect([z?.current, z?.hits, z?.misses, z?.without, z?.outcomesWithout]).toStrictEqual([
      null,
      0,
      1,
      4,
      2,
    ]);
    expect(z?.lift).toBeLessThan(0);
    expect(Object.keys(r.config.intents.buy?.signals ?? {})).toStrictEqual(['x', 'y']);
    // Probing candidates changes nothing about the declared signals.
    expect(f?.signals).toStrictEqual(report.intents[0]?.signals);
  });
});

describe('tune preserves the evidence score contract', () => {
  const entries: LogEntry[] = [];
  for (let i = 0; i < 20; i++) {
    const at = T + i * DAY;
    entries.push(ev('balanced', at, 'app.opened'));
    entries.push(ev('balanced', at + 1, i < 10 ? 'good' : 'bad'));
    if (i % 2 === 0) entries.push(ev('balanced', at + 2, 'neutral'));
    if (i < 10) {
      entries.push(ev('balanced', at + 3, 'candidate.good'));
      entries.push(ev('balanced', at + 4, 'buy.done'));
    }
    entries.push(end('balanced', at + 5));
  }

  it.each(LIFT_TYPES)(
    '%s drops neutral signals and fits bounded signed weights and intervals',
    (lift) => {
      const config: EngineConfig = {
        ...buyConfig,
        learning: { lift },
        intents: {
          buy: {
            ...buyConfig.intents.buy!,
            priorStrength: 10,
            signals: { good: 3, bad: 3, neutral: 3 },
          },
        },
      };
      const report = tune(entries, config, { halfLives: [1e15], allEvents: true });
      const fitted = report.intents[0]!;
      const good = fitted.signals.find((s) => s.signal === 'good')!;
      const bad = fitted.signals.find((s) => s.signal === 'bad')!;
      const neutral = fitted.signals.find((s) => s.signal === 'neutral')!;
      expect(neutral.score).toBe(0);
      expect(neutral.weight).toBeNull();
      expect(report.config.intents.buy!.signals).not.toHaveProperty('neutral');
      expect(good.weight).toBeGreaterThan(0);
      expect(bad.weight).toBeLessThan(0);
      expect(fitted.candidates.find((s) => s.signal === 'candidate.good')!.weight).toBeGreaterThan(
        0,
      );
      for (const signal of [...fitted.signals, ...fitted.candidates]) {
        if (signal.score === null) {
          // Seen in every counted episode: nothing to compare with, so no lift and no interval.
          expect([signal.without, signal.lift, signal.low, signal.high]).toStrictEqual([
            0,
            null,
            null,
            null,
          ]);
          continue;
        }
        expect(signal.score).toBeGreaterThanOrEqual(-1);
        expect(signal.score).toBeLessThanOrEqual(1);
        expect(Math.abs(signal.weight ?? 0)).toBeLessThanOrEqual(10);
        expect(signal.low).toBeGreaterThanOrEqual(-10);
        expect(signal.high).toBeLessThanOrEqual(10);
        expect(signal.low as number).toBeLessThanOrEqual(signal.high as number);
      }
      expect(() => validateConfig(report.config)).not.toThrow();
      if (lift === 'risk-ratio' || lift === 'odds-ratio' || lift === 'association-rule') {
        expect(neutral.lift).toBe(1);
        expect(formatTuneText(report)).toContain('| score');
      }
    },
  );
});

// ---- a population with planted structure ----

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * 40 installs, 12 daily sessions each. `good` raises the chance of the outcome, `bad` lowers it,
 * `noise` is independent of it, `app.opened` is in every session. Installs differ in how likely
 * they are to convert at all, so the base rates spread.
 */
function population(): { entries: LogEntry[]; outcomes: number; sessions: number } {
  const random = rng(42);
  const entries: LogEntry[] = [];
  let outcomes = 0;
  let sessions = 0;
  for (let i = 0; i < 40; i++) {
    const install = `install-${i}`;
    const propensity = 0.4 + 1.2 * random();
    for (let d = 0; d < 12; d++) {
      const t0 = T + d * DAY + Math.floor(random() * 6 * 60) * MINUTE;
      entries.push(ev(install, t0, 'app.opened'));
      const good = random() < 0.5;
      const bad = random() < 0.3;
      if (good) entries.push(ev(install, t0 + MINUTE, 'good'));
      if (bad) entries.push(ev(install, t0 + 2 * MINUTE, 'bad'));
      if (random() < 0.5) entries.push(ev(install, t0 + 3 * MINUTE, 'noise'));
      const base = good && bad ? 0.3 : good ? 0.6 : bad ? 0.02 : 0.1;
      if (random() < Math.min(0.95, base * propensity)) {
        entries.push(ev(install, t0 + 5 * MINUTE, 'buy.done'));
        outcomes++;
      }
      entries.push(end(install, t0 + 10 * MINUTE));
      sessions++;
    }
  }
  return { entries, outcomes, sessions };
}

const populationConfig: EngineConfig = {
  episodeTimeout: 30 * MINUTE,
  intents: {
    buy: {
      prior: 0.1,
      priorStrength: 10,
      halfLife: DAY,
      signals: { good: 1, bad: -1, noise: 1 },
      outcome: 'buy.done',
      reveal: { cooldown: DAY },
    },
  },
};

describe('tune, on a population with planted structure', () => {
  const { entries, outcomes, sessions } = population();
  const report = tune(deepFreeze(entries), populationConfig, { allEvents: true });
  const [fit] = report.intents;
  const signal = (name: string) =>
    [...(fit?.signals ?? []), ...(fit?.candidates ?? [])].find((f) => f.signal === name);

  it('counts every session once and recovers the base rate', () => {
    expect(fit?.episodes).toBe(sessions);
    expect(fit?.outcomes).toBe(outcomes);
    expect(fit?.installs).toBe(40);
    expect(fit?.prior.value).toBeCloseTo((outcomes + 1) / (sessions + 2), 12);
  });

  it('finds the planted signals: good up, bad down, noise nowhere', () => {
    const good = signal('good');
    const bad = signal('bad');
    const noise = signal('noise');
    expect(good?.weight).toBeGreaterThan(0);
    expect(bad?.weight).toBeLessThan(0);
    expect(good?.low).toBeGreaterThan(0);
    expect(bad?.high).toBeLessThan(0);
    expect(noise?.low).toBeLessThan(0);
    expect(noise?.high).toBeGreaterThan(0);
    expect(Math.abs(noise?.weight ?? 0)).toBeLessThan(good?.weight as number);
    for (const f of [good, bad, noise]) expect(f?.thin).toBe(false);
  });

  it('leaves out a signal that is never absent: no contrast, and ubiquitous', () => {
    const opened = signal('app.opened');
    expect(opened?.current).toBeNull();
    expect(opened?.without).toBe(0);
    expect(opened?.contrast).toBe(0);
    expect(opened?.thin).toBe(true);
    // Everything with the signal, nothing without it.
    expect(opened?.hits).toBe(outcomes);
    expect(opened?.share).toBe(1);
    expect(opened?.ubiquitous).toBe(true);
    expect(opened?.weight).toBeNull();
    // Nothing to compare its rate with: no lift and no interval, rather than numbers against a made-up baseline.
    expect(opened?.lift).toBeNull();
    expect(opened?.score).toBeNull();
    expect(opened?.low).toBeNull();
    expect(opened?.high).toBeNull();
  });

  it('reads the prior strength from the spread of per-install base rates, inside the range', () => {
    expect(fit?.priorStrength.source).toBe('spread');
    expect(fit?.priorStrength.value).toBeGreaterThanOrEqual(STRENGTH_RANGE[0]);
    expect(fit?.priorStrength.value).toBeLessThanOrEqual(STRENGTH_RANGE[1]);
    expect(fit?.priorStrength.note).toMatch(/^spread of base rates across 40 installs/);
  });

  it('tries every half-life in the grid plus the current one, and keeps the lowest Brier score', () => {
    const grid = [...new Set([...DEFAULT_HALF_LIVES, DAY])].sort((a, b) => a - b);
    expect(fit?.halfLife.curve.map((p) => p.halfLife)).toStrictEqual(grid);
    const briers = fit?.halfLife.curve.map((p) => p.brier as number) ?? [];
    const best = Math.min(...briers);
    const atCurrent = fit?.halfLife.curve.find((p) => p.halfLife === DAY)?.brier as number;
    const chosen = fit?.halfLife.curve.find((p) => p.halfLife === fit.halfLife.value);
    // The rule: the best point, unless it gains less than FLAT_GRID_GAIN on the current value.
    if ((atCurrent - best) / atCurrent < FLAT_GRID_GAIN) {
      expect(fit?.halfLife.source).toBe('kept');
      expect(fit?.halfLife.value).toBe(DAY);
    } else {
      expect(fit?.halfLife.source).toBe('grid');
      expect(chosen?.brier).toBe(best);
    }
    expect(fit?.halfLife.window).toBe(DAY);
    expect(fit?.beatsBaseRate).toBe(true);
  });

  it('emits a config the engine accepts, and replay scores it exactly as the grid did', () => {
    expect(() => validateConfig(report.config)).not.toThrow();
    const scored = replay(entries, report.config, {
      intents: ['buy'],
      thresholds: [0.5],
      window: DAY,
    });
    const chosen = fit?.halfLife.curve.find((p) => p.halfLife === fit.halfLife.value);
    expect(scored.intents[0]?.brier).toBe(chosen?.brier);
    expect(report.config.intents.buy?.halfLife).toBe(fit?.halfLife.value);
    expect(report.config.intents.buy?.priorStrength).toBe(fit?.priorStrength.value);
    expect(Object.keys(report.config.intents.buy?.signals ?? {}).sort()).toStrictEqual(
      (fit?.signals ?? [])
        .filter((f) => f.weight !== null)
        .map((f) => f.signal)
        .sort(),
    );
  });
});

// ---- the three rules learned from a real clickstream ----

/**
 * Twenty-one installs, one episode each, closed 200 ms after they open. `u` is seen in 19 of them
 * (installs 1 to 19), `v` in 18 (installs 2 to 19); installs 0 and 20 see only an event of no
 * intent. The outcome follows in installs 0 to 9 and 20. So: 21 episodes, 11 outcomes; u 9 hits,
 * 10 misses, and both episodes without it end with the outcome; v 8 hits, 10 misses, and all three
 * episodes without it end with the outcome.
 */
function ubiquityLog(): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 0; i <= 20; i++) {
    const id = `u${i}`;
    entries.push(ev(id, T, i === 0 || i === 20 ? 'other' : 'u'));
    if (i >= 2 && i <= 19) entries.push(ev(id, T + 1, 'v'));
    if (i <= 9 || i === 20) entries.push(ev(id, T + 50, 'buy.done'));
    entries.push(end(id, T + 200));
  }
  return entries;
}

const withSignals = (signals: Record<string, number>): EngineConfig => ({
  intents: { buy: { ...buyConfig.intents.buy!, signals } },
});

describe('ubiquitous signals', () => {
  const report = tune(deepFreeze(ubiquityLog()), withSignals({ u: 1, v: 1 }), {
    halfLives: [1e15],
  });
  const [fit] = report.intents;
  const [u, v] = fit?.signals ?? [];

  it('counts the log as described', () => {
    expect([fit?.episodes, fit?.outcomes, fit?.installs]).toStrictEqual([21, 11, 21]);
    expect([u?.hits, u?.misses, u?.without, u?.outcomesWithout]).toStrictEqual([9, 10, 2, 2]);
    expect([v?.hits, v?.misses, v?.without, v?.outcomesWithout]).toStrictEqual([8, 10, 3, 3]);
  });

  it('leaves out a signal seen in more than 90% of episodes, whatever its lift', () => {
    expect(UBIQUITY_SHARE).toBe(0.9);
    expect(u?.share).toBeCloseTo(19 / 21, 12);
    expect(u?.ubiquitous).toBe(true);
    // The contrast would have called it negative: shrunk toward the base rate 11/21, its rate is
    // (9 + 22/21) / 21 with it against (2 + 22/21) / 4 without.
    const base = 11 / 21;
    const uWith = (9 + 2 * base) / 21;
    const uWithout = (2 + 2 * base) / 4;
    expect(u?.lift).toBeCloseTo((uWith - uWithout) / uWithout, 12);
    expect(u?.weight).toBeNull();
    expect(report.config.intents.buy?.signals).not.toHaveProperty('u');
  });

  it('keeps fitting a signal at or below the share', () => {
    expect(v?.share).toBeCloseTo(18 / 21, 12);
    expect(v?.ubiquitous).toBe(false);
    const base = 11 / 21;
    const vWith = (8 + 2 * base) / 20;
    const vWithout = (3 + 2 * base) / 5;
    expect(v?.lift).toBeCloseTo((vWith - vWithout) / vWithout, 12);
    expect(v?.weight).toBe(
      Math.round((fit?.priorStrength.value as number) * (v?.lift as number) * 100) / 100,
    );
    expect(report.config.intents.buy?.signals).toStrictEqual({ v: v?.weight });
  });

  it('is exactly at the boundary: 18 of 20 is not ubiquitous, 19 of 20 is', () => {
    const twenty = ubiquityLog().filter((e) => e.installId !== 'u20');
    const [fit20] = tune(twenty, withSignals({ u: 1, v: 1 }), { halfLives: [1e15] }).intents;
    const [u20, v20] = fit20?.signals ?? [];
    expect(fit20?.episodes).toBe(20);
    expect(u20?.share).toBeCloseTo(0.95, 12);
    expect(u20?.ubiquitous).toBe(true);
    expect(v20?.share).toBeCloseTo(0.9, 12);
    expect(v20?.ubiquitous).toBe(false);
  });

  it('says so in the report', () => {
    const text = formatTuneText(report);
    expect(text).toContain(
      '| u      | –      | 1.00 | -1.21 to -0.29 | -0.37 | 9 / 10              | 2 / 2                        | in 90.5% of episodes, so it cannot tell them apart; left out of the config; thin: 1.8 of 10 contrast |',
    );
    expect(text).not.toContain('no measurable lift');
  });
});

describe('a flat half-life grid', () => {
  it('keeps the current value when the best point gains less than 1%, and says so', () => {
    expect(FLAT_GRID_GAIN).toBe(0.01);
    // Half-lives of 1e8 and 1e9 ms both dwarf the hand log's 200 ms span: the scores differ in
    // the ninth decimal, beyond the exact-tie tolerance and far below 1%.
    const config: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy!, halfLife: 1e8 } },
    };
    const [fit] = tune(handLog(), config, { halfLives: [1e9] }).intents;
    expect(fit?.halfLife.curve.map((p) => p.halfLife)).toStrictEqual([1e8, 1e9]);
    const [atCurrent, best] = fit?.halfLife.curve.map((p) => p.brier as number) ?? [];
    expect(best).toBeLessThan(atCurrent as number);
    expect((atCurrent as number) - (best as number)).toBeGreaterThan(1e-12);
    expect(fit?.halfLife.source).toBe('kept');
    expect(fit?.halfLife.value).toBe(1e8);
    expect(fit?.halfLife.note).toBe(
      'kept: the grid is flat, the best point (11d 13h, 0.1981) improves on the current value (0.1981) by 0.00%, less than 1% (always predicting the base rate: 0.2400)',
    );
    const text = formatTuneText(tune(handLog(), config, { halfLives: [1e9] }));
    expect(text).toContain('(lower is better): 1d 3h 0.1981 *, 11d 13h 0.1981\n');
  });

  it('still moves to the best point when the grid is not flat', () => {
    // A half-life of 1 ms loses the first x before the second arrives; 1e15 keeps it. 10% apart.
    const config: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy!, halfLife: 1 } },
    };
    const [fit] = tune(handLog(), config, { halfLives: [1e15] }).intents;
    const [atCurrent, best] = fit?.halfLife.curve.map((p) => p.brier as number) ?? [];
    expect(((atCurrent as number) - (best as number)) / (atCurrent as number)).toBeGreaterThan(
      FLAT_GRID_GAIN,
    );
    expect(fit?.halfLife.source).toBe('grid');
    expect(fit?.halfLife.value).toBe(1e15);
    expect(fit?.halfLife.note).toMatch(/^lowest Brier score over the grid, 0\.1981 \(always/);
  });
});

describe('the base rate check', () => {
  it('says when the fitted intent does not beat its base rate, with no signal left', () => {
    // Only the ubiquitous u: it is left out, p never leaves the prior, and the prior (11 of 21
    // episodes, smoothed) is not the share of events the outcome follows within the window.
    const report = tune(ubiquityLog(), withSignals({ u: 1 }), { halfLives: [1e15] });
    const [fit] = report.intents;
    expect(report.config.intents.buy?.signals).toStrictEqual({});
    const [point] = fit?.halfLife.curve ?? [];
    expect(point?.brier).toBeGreaterThan(fit?.halfLife.brierBaseline as number);
    expect(fit?.beatsBaseRate).toBe(false);
    const text = formatTuneText(report);
    expect(text).toContain(
      '\nThis intent does not beat its base rate: the fitted config scores 0.2510 where always predicting the base rate scores 0.2498 (lower is better). No signal is left in the config, so p never leaves the prior, and the prior (the share of episodes that end with buy.done) is not the share of events that buy.done follows within 100ms. Drop the intent, or find signals that tell its episodes apart (--all-events measures every other event in the log).\n',
    );
  });

  it('names the signals when some are left and still do not separate the episodes', () => {
    const report = tune(ubiquityLog(), withSignals({ u: 1, v: 1 }), { halfLives: [1e15] });
    expect(report.intents[0]?.beatsBaseRate).toBe(false);
    expect(formatTuneText(report)).toContain(
      'Its signals do not separate the events that buy.done follows within 100ms from the rest.',
    );
  });

  it('is true, and silent, when the fit beats the base rate', () => {
    const [fit] = tune(handLog(), buyConfig, { halfLives: [1e15] }).intents;
    expect(fit?.beatsBaseRate).toBe(true);
    expect(formatTuneText(tune(handLog(), buyConfig, { halfLives: [1e15] }))).not.toContain(
      'does not beat its base rate',
    );
  });

  it('is null when nothing could be scored', () => {
    // Every point's window runs past the end of the log: nothing to score the grid with.
    const short = ubiquityLog().map((e) => (e.kind === 'end' ? { ...e, at: T + 60 } : e));
    const [fit] = tune(short, withSignals({ u: 1, v: 1 }), { halfLives: [1e15] }).intents;
    expect(fit?.halfLife.source).toBe('kept');
    expect(fit?.beatsBaseRate).toBeNull();
  });
});

describe('attribution', () => {
  it('is switched off while counting, kept on for the grid and in the printed config', () => {
    // The verdict on each episode is its own: Monday's miss is Monday's, however the device
    // later credits it. So the counts match the config without the window, and the window stays.
    const withWindow: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy!, attribution: 1e15 } },
    };
    const plain = tune(handLog(), buyConfig, { halfLives: [1e15] });
    const windowed = tune(handLog(), withWindow, { halfLives: [1e15] });
    const counts = (fit: (typeof plain.intents)[number] | undefined) =>
      fit?.signals.map((f) => [f.signal, f.hits, f.misses, f.without, f.outcomesWithout]);
    expect(counts(windowed.intents[0])).toStrictEqual(counts(plain.intents[0]));
    expect(windowed.intents[0]?.episodes).toBe(plain.intents[0]?.episodes);
    expect(windowed.config.intents.buy?.attribution).toBe(1e15);
    // Replay runs the engine as the device would, window included, so the grid may differ.
    expect(windowed.intents[0]?.halfLife.curve).toHaveLength(1);
  });
});

describe('wilson', () => {
  it('is the Wilson score interval', () => {
    expect(wilson(0, 0, 1.6449)).toStrictEqual([0, 1]);
    const [low, high] = wilson(2, 3, 1.6449);
    expect(low).toBeCloseTo(0.2536, 3);
    expect(high).toBeCloseTo(0.9218, 3);
    expect(wilson(5, 5, 1.6449)[1]).toBe(1);
    expect(wilson(0, 5, 1.6449)[0]).toBe(0);
  });

  it.each(['log-lift', 'odds-ratio'] as const)(
    '%s keeps unseen-signal intervals finite at both exact Wilson endpoints',
    (lift) => {
      const config: EngineConfig = {
        ...buyConfig,
        learning: { lift },
        intents: { buy: { ...buyConfig.intents.buy!, signals: { x: 3, unseen: 1 } } },
      };
      const fitted = tune(handLog(), config, { halfLives: [1e15] }).intents[0]!;
      const unseen = fitted.signals.find((signal) => signal.signal === 'unseen')!;
      // No observations: the point estimate is the base rate itself (2 of 5), and Wilson
      // supplies [0, 1]. Without the endpoint clamp, log(0) and odds(1) become infinities, then
      // scores are NaN.
      expect(unseen.hits + unseen.misses).toBe(0);
      expect(unseen.qWith).toBe(0.4);
      expect(unseen.weight).toBeNull();
      expect(Number.isFinite(unseen.low)).toBe(true);
      expect(Number.isFinite(unseen.high)).toBe(true);
      expect(unseen.low).toBeLessThan(0);
      expect(unseen.high).toBeGreaterThan(0);
      expect(unseen.low).toBeGreaterThanOrEqual(-fitted.priorStrength.value);
      expect(unseen.high).toBeLessThanOrEqual(fitted.priorStrength.value);
    },
  );
});

describe('DEFAULT_PRIOR_EPISODES', () => {
  it('is the learning.priorEpisodes the engine applies when none is configured', () => {
    const run = (config: EngineConfig) => {
      let s = createState(config);
      // Three episodes with x and the outcome, three without either: contrast on both sides, so the
      // blend of initial and learned weight depends on priorEpisodes.
      for (let i = 0; i < 6; i++) {
        s = observe(s, { name: i % 2 === 0 ? 'x' : 'z', at: T + i * DAY });
        if (i % 2 === 0) s = observe(s, { name: 'buy.done', at: T + i * DAY + 1 });
        s = endEpisode(s, T + i * DAY + 2);
      }
      return explain(s, 'buy', T + 7 * DAY);
    };
    const explicit: EngineConfig = {
      ...buyConfig,
      learning: { priorEpisodes: DEFAULT_PRIOR_EPISODES },
    };
    expect(run(buyConfig)).toStrictEqual(run(explicit));
    expect(run(buyConfig)).not.toStrictEqual(run({ ...buyConfig, learning: { priorEpisodes: 3 } }));
    expect(MIN_INSTALLS_FOR_SPREAD).toBe(10);
  });
});

// ---- the command, end to end over the files ----

function io(cwd = root) {
  const out = { stdout: '', stderr: '' };
  return {
    io: {
      stdout: (text: string) => {
        out.stdout += text;
      },
      stderr: (text: string) => {
        out.stderr += text;
      },
      readFile: (path: string) => readFileSync(path, 'utf8'),
      cwd,
    },
    out,
  };
}

const fixture = (name: string) => `tests/fixtures/replay/${name}`;
const tuneArgs = (log: string, ...more: string[]) => [
  'tune',
  fixture(log),
  '--config',
  fixture('config.json'),
  ...more,
];

describe('oracular tune', () => {
  it('prints the fit and the config to paste, warning about a thin population', async () => {
    const { io: x, out } = io();
    expect(await run(tuneArgs('shadow.ndjson'), x)).toBe(0);
    expect(out.stdout).toMatch(/^oracular tune: 3 installs, 59 records \(59 shadow, 0 live\)/);
    expect(out.stdout).toMatch(/\nupgrade: outcome upgrade.completed, /);
    expect(out.stdout).toMatch(/\nstuck: outcome help.article.read, /);
    expect(out.stdout).toMatch(/\ntip: skipped, declares no outcome event/);
    expect(out.stdout).toMatch(/Config with every fitted value swapped in/);
    expect(out.stderr).toMatch(/^oracular: warning: 3 installs in the log\./);
  });

  it('the example in the Shadow mode guide is this exact output', async () => {
    const { io: x, out } = io();
    await run(tuneArgs('shadow.ndjson', '--intent', 'stuck'), x);
    const guide = readFileSync(`${root}docs/guide/shadow-mode.md`, 'utf8');
    const match = /<!-- tune:example -->\n```text\n([\s\S]*?)```\n<!-- \/tune:example -->/.exec(
      guide,
    );
    expect(match, 'docs/guide/shadow-mode.md has a tune:example block').not.toBeNull();
    expect(match![1]).toBe(out.stdout);
  });

  it('agrees with the pure tune, as JSON, and its config replays', async () => {
    const { io: x, out } = io();
    expect(await run(tuneArgs('shadow.ndjson', '--json', '--intent', 'upgrade'), x)).toBe(0);
    const printed = JSON.parse(out.stdout);
    const entries = (await import('../cli/log')).parseLog(
      readFileSync(`${root}${fixture('shadow.ndjson')}`, 'utf8'),
      'shadow.ndjson',
    ).entries;
    const config = JSON.parse(readFileSync(`${root}${fixture('config.json')}`, 'utf8'));
    expect(printed).toStrictEqual(
      JSON.parse(
        JSON.stringify(
          tune(entries, config, { intents: ['upgrade'], includeLive: false, allEvents: false }),
        ),
      ),
    );
    expect(() => validateConfig(printed.config)).not.toThrow();
    const again = io();
    again.io.readFile = (path) =>
      path.endsWith('config.json') ? JSON.stringify(printed.config) : readFileSync(path, 'utf8');
    expect(
      await run(
        ['replay', fixture('shadow.ndjson'), '--config', fixture('config.json'), '--json'],
        again.io,
      ),
    ).toBe(0);
  });

  it('refuses a live-only log unless --include-live is given, and then warns', async () => {
    const refused = io();
    expect(await run(tuneArgs('live.ndjson'), refused.io)).toBe(1);
    expect(refused.out.stderr).toMatch(
      /every record in the log is live, so there is nothing to fit/,
    );
    const included = io();
    expect(await run(tuneArgs('live.ndjson', '--include-live', '--json'), included.io)).toBe(0);
    expect(included.out.stderr).toMatch(/counting \d+ live records as asked/);
    expect(JSON.parse(included.out.stdout).scored).toBe('all');
  });

  it('warns on a mixed log and counts only its shadow episodes', async () => {
    const { io: x, out } = io();
    expect(await run(tuneArgs('mixed.ndjson', '--json'), x)).toBe(0);
    expect(out.stderr).toMatch(/the log mixes shadow and live records/);
    expect(JSON.parse(out.stdout).scored).toBe('shadow');
  });

  it('accepts --half-lives with units and --all-events', async () => {
    const { io: x, out } = io();
    expect(
      await run(
        tuneArgs(
          'shadow.ndjson',
          '--half-lives=12h,3d',
          '--all-events',
          '--json',
          '--intent',
          'upgrade',
        ),
        x,
      ),
    ).toBe(0);
    const report = JSON.parse(out.stdout);
    expect(
      report.intents[0].halfLife.curve.map((p: { halfLife: number }) => p.halfLife),
    ).toStrictEqual([12 * 3_600_000, 3 * DAY, 7 * DAY]);
    expect(report.intents[0].candidates.length).toBeGreaterThan(0);
  });

  it('reports usage errors with exit code 2', async () => {
    const cases: [string[], RegExp][] = [
      [['tune'], /tune needs at least one log file/],
      [['tune', fixture('shadow.ndjson')], /tune needs --config/],
      [tuneArgs('shadow.ndjson', '--half-lives', '0'), /--half-lives must be a positive duration/],
      [
        tuneArgs('shadow.ndjson', '--half-lives', '1d,soon'),
        /--half-lives must be a positive duration/,
      ],
      [tuneArgs('shadow.ndjson', '--intent', 'nope'), /--intent nope: the config declares/],
      [tuneArgs('shadow.ndjson', '--all-events=yes'), /--all-events takes no value/],
      [tuneArgs('shadow.ndjson', '--bogus'), /unknown option --bogus/],
      [['dance'], /unknown command "dance"/],
    ];
    for (const [argv, message] of cases) {
      const { io: x, out } = io();
      expect(await run(argv, x), argv.join(' ')).toBe(2);
      expect(out.stderr, argv.join(' ')).toMatch(message);
    }
  });

  it('prints its help', async () => {
    const { io: x, out } = io();
    expect(await run(['tune', '--help'], x)).toBe(0);
    expect(out.stdout).toMatch(/^Usage: oracular tune/);
    expect(out.stdout).toMatch(/--all-events/);
  });
});

describe('tune with episodePerOutcome', () => {
  it('counts each attempt, where the default counts the session', () => {
    const T0 = 1_700_000_000_000;
    const config: EngineConfig = {
      episodeTimeout: 30 * 60_000,
      intents: {
        stuck: {
          prior: 0.15,
          priorStrength: 5,
          halfLife: 600_000,
          saturate: false,
          signals: { 'upload.rows.failed': 2 },
          outcome: 'upload.completed',
        },
      },
    };
    const entries: LogEntry[] = [
      { kind: 'event', installId: 'u1', mode: 'shadow', name: 'upload.rows.failed', at: T0 },
      { kind: 'event', installId: 'u1', mode: 'shadow', name: 'upload.completed', at: T0 + 60_000 },
      {
        kind: 'event',
        installId: 'u1',
        mode: 'shadow',
        name: 'upload.completed',
        at: T0 + 300_000,
      },
      { kind: 'end', installId: 'u1', mode: 'shadow', at: T0 + 1_200_000 },
    ];
    expect(tune(entries, config).intents[0]).toMatchObject({ episodes: 1, outcomes: 1 });
    const attempts: EngineConfig = {
      ...config,
      intents: { stuck: { ...config.intents.stuck!, episodePerOutcome: true } },
    };
    const fit = tune(entries, attempts).intents[0]!;
    expect(fit).toMatchObject({ episodes: 2, outcomes: 2 });
    // The failure signal now has its contrast: one attempt with it, one without.
    expect(fit.signals[0]).toMatchObject({
      signal: 'upload.rows.failed',
      hits: 1,
      misses: 0,
      without: 1,
      outcomesWithout: 1,
    });
  });
});
