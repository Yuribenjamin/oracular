import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createState,
  type EngineConfig,
  endEpisode,
  explain,
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
  MIN_INSTALLS_FOR_SPREAD,
  STRENGTH_RANGE,
  tune,
  wilson,
} from '../cli/tune';
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
    // x: qWith (2+1)/(3+2) = 0.6, qWithout (0+1)/(2+2) = 0.25, lift 0.35/0.75.
    expect(x?.qWith).toBeCloseTo(0.6, 12);
    expect(x?.qWithout).toBeCloseTo(0.25, 12);
    expect(x?.lift).toBeCloseTo(0.35 / 0.75, 12);
    expect(x?.weight).toBe(0.93);
    expect(x?.contrast).toBeCloseTo(1.2, 12);
    expect(x?.thin).toBe(true);
    // y: qWith (1+1)/(2+2) = 0.5, qWithout (1+1)/(3+2) = 0.4, lift 0.1/0.6.
    expect(y?.qWith).toBeCloseTo(0.5, 12);
    expect(y?.qWithout).toBeCloseTo(0.4, 12);
    expect(y?.lift).toBeCloseTo(0.1 / 0.6, 12);
    expect(y?.weight).toBe(0.33);
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
          buy: { ...buyConfig.intents.buy, prior: 0.4286, signals: { x: 0.93, y: 0.33 } },
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

  it('asks for a window when the intent has no cooldown', () => {
    const noCooldown: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy, reveal: { cooldown: 0 } } as never },
    };
    expect(() => tune(handLog(), noCooldown)).toThrow(/pass --window/);
    expect(
      tune(handLog(), noCooldown, { window: 100, halfLives: [1e15] }).intents[0]?.halfLife.window,
    ).toBe(100);
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

  it('measures a signal that is never absent as no lift at all', () => {
    const opened = signal('app.opened');
    expect(opened?.current).toBeNull();
    expect(opened?.without).toBe(0);
    expect(opened?.contrast).toBe(0);
    expect(opened?.thin).toBe(true);
    // Everything with the signal, nothing without it: the engine's lift of its rate over the smoothed empty contrast.
    expect(opened?.hits).toBe(outcomes);
    expect(opened?.hits).toBe(outcomes);
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
    expect(fit?.halfLife.source).toBe('grid');
    const briers = fit?.halfLife.curve.map((p) => p.brier as number) ?? [];
    const best = Math.min(...briers);
    const chosen = fit?.halfLife.curve.find((p) => p.halfLife === fit.halfLife.value);
    expect(chosen?.brier).toBe(best);
    expect(fit?.halfLife.window).toBe(DAY);
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

describe('wilson', () => {
  it('is the Wilson score interval', () => {
    expect(wilson(0, 0, 1.6449)).toStrictEqual([0, 1]);
    const [low, high] = wilson(2, 3, 1.6449);
    expect(low).toBeCloseTo(0.2536, 3);
    expect(high).toBeCloseTo(0.9218, 3);
    expect(wilson(5, 5, 1.6449)[1]).toBe(1);
    expect(wilson(0, 5, 1.6449)[0]).toBe(0);
  });
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
