import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createEndRecord,
  createRecord,
  createState,
  type EngineConfig,
  type EngineState,
  endEpisode,
  evidenceToReveal,
  markRevealed,
  observe,
  type RecordMode,
  shouldReveal,
} from 'oracular';
import { describe, expect, it } from 'vitest';
import { parseLog } from '../cli/log';
import { DEFAULT_THRESHOLD, type LogEntry, replay } from '../cli/replay';
import { formatDuration } from '../cli/report';
import { type Io, run } from '../cli/run';
import { assertInvariants } from './helpers';

const fixtures = fileURLToPath(new URL('./fixtures/replay/', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(`${fixtures}config.json`, 'utf8')) as EngineConfig;

// ---- a small scenario whose metrics are computed by hand ----

/**
 * prior 0.3, strength 2 (α₀ 0.6, β₀ 1.4), one signal x of weight 3, no repeat discount, and a
 * half-life so long that decay is invisible. One x: α 3.6, p 0.72, lower 0.485, no reveal at
 * 0.5. Two x: α 6.6, p 0.825, lower 0.663, a reveal. Window: the 100 ms cooldown.
 */
const buyConfig: EngineConfig = {
  intents: {
    buy: {
      prior: 0.3,
      priorStrength: 2,
      halfLife: 1e15,
      signals: { x: 3 },
      outcome: 'buy.done',
      saturate: false,
      reveal: { cooldown: 100 },
    },
  },
};

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

/** u1: revealed at 10, bought at 50. u2: revealed at 10, never bought. u3: bought at 20, unrevealed. */
function buyLog(u2Mode: RecordMode = 'shadow'): LogEntry[] {
  return [
    ev('u1', 0, 'x'),
    ev('u1', 10, 'x'),
    ev('u1', 50, 'buy.done'),
    ev('u1', 500, 'noise'),
    ev('u2', 0, 'x'),
    ev('u2', 10, 'x', u2Mode),
    ev('u2', 500, 'noise', u2Mode),
    ev('u3', 20, 'buy.done'),
    ev('u3', 500, 'noise'),
  ];
}

describe('replay, on a log small enough to check by hand', () => {
  it('measures precision, recall, lead time, reveals per user and calibration', () => {
    const report = replay(buyLog(), buyConfig, { thresholds: [0.5, 0.7] });
    expect(report).toMatchObject({
      installs: 3,
      records: 9,
      shadow: 9,
      live: 0,
      start: 0,
      end: 500,
    });
    const buy = report.intents[0]!;
    expect(buy).toMatchObject({ intent: 'buy', outcome: 'buy.done', window: 100, installs: 3 });

    const [at05, at07] = buy.thresholds;
    // 0.5: reveals at 10 for u1 (bought at 50) and u2 (never). Outcomes: u1 at 50 (revealed at
    // 10, inside [−50, 50)) and u3 at 20 (no reveal). u2's evidence stays put, so once its
    // cooldown is over the gate opens again at 500: a third reveal, whose window lies past the end
    // of the log, so it is censored rather than counted as a miss.
    expect(at05).toMatchObject({
      threshold: 0.5,
      configured: true,
      reveals: 2,
      correct: 1,
      precision: 0.5,
      outcomes: 2,
      caught: 1,
      recall: 0.5,
      leadTime: 40,
      censored: 1,
    });
    expect(at05!.revealsPerUser).toBeCloseTo(2 / 3, 12);
    // 0.7: p reaches 0.825 but the lower bound only 0.663, so nothing is ever revealed.
    expect(at07).toMatchObject({ reveals: 0, precision: null, recall: 0, leadTime: null });

    // Reliability: p after each x (u1: 0.72 then 0.825, both followed by the purchase; u2 the
    // same, never followed). The three noise events at 500 sit at the very end of the log, so
    // their windows cannot be observed: censored.
    expect(buy.points).toBe(4);
    expect(buy.censored).toBe(3);
    expect(buy.reliability).toHaveLength(2);
    expect(buy.reliability[0]).toMatchObject({ count: 2, observed: 0.5 });
    expect(buy.reliability[0]!.from).toBeCloseTo(0.7, 12);
    expect(buy.reliability[0]!.meanP).toBeCloseTo(0.72, 9);
    expect(buy.reliability[1]!.meanP).toBeCloseTo(0.825, 9);
    const brier = (0.28 ** 2 + 0.175 ** 2 + 0.72 ** 2 + 0.825 ** 2) / 4;
    expect(buy.brier).toBeCloseTo(brier, 9);
    expect(buy.baseRate).toBe(0.5);
    expect(buy.brierBaseline).toBe(0.25);
  });

  it('a shorter window turns the late purchase into a miss', () => {
    const at05 = replay(buyLog(), buyConfig, { thresholds: [0.5], window: 30 }).intents[0]!
      .thresholds[0]!;
    // Reveal at 10, purchase at 50: outside (10, 40]. The purchase's run-up [20, 50) has no reveal.
    expect(at05).toMatchObject({ reveals: 2, correct: 0, precision: 0, caught: 0, recall: 0 });
  });

  it('scores an intent with no cooldown over its half-life, and refuses an explicit empty window', () => {
    const noCooldown: EngineConfig = {
      intents: { buy: { ...buyConfig.intents.buy!, reveal: { cooldown: 0 } } },
    };
    const fallback = replay(buyLog(), noCooldown, { thresholds: [0.5] }).intents[0]!;
    expect(fallback).toMatchObject({
      window: buyConfig.intents.buy!.halfLife,
      windowSource: 'halfLife',
      windowIsCooldown: false,
    });
    expect(replay(buyLog(), buyConfig, { thresholds: [0.5] }).intents[0]).toMatchObject({
      window: 100,
      windowSource: 'cooldown',
      windowIsCooldown: true,
    });
    // An empty window would score every reveal as wrong and every point as a non-outcome, silently.
    expect(() => replay(buyLog(), buyConfig, { thresholds: [0.5], window: 0 })).toThrow(
      /window must be greater than 0/,
    );
    // Given a window, the intent is scored like any other.
    const buy = replay(buyLog(), noCooldown, { thresholds: [0.5], window: 100 }).intents[0]!;
    expect(buy).toMatchObject({ window: 100, windowSource: 'option', windowIsCooldown: false });
    expect(buy.thresholds[0]).toMatchObject({ reveals: 2, correct: 1, precision: 0.5 });
  });

  it('scores only shadow periods of a mixed log, unless told to include live ones', () => {
    // u2 goes live at 10: its reveal there and its first point (window (0, 100]) touch live records.
    const mixed = replay(buyLog('live'), buyConfig, { thresholds: [0.5] });
    expect(mixed).toMatchObject({ shadow: 7, live: 2, mixedInstalls: 1, scored: 'shadow' });
    expect(mixed.intents[0]!.thresholds[0]).toMatchObject({
      reveals: 1,
      correct: 1,
      precision: 1,
      outcomes: 2,
      caught: 1,
    });
    expect(mixed.intents[0]!.points).toBe(2);

    const all = replay(buyLog('live'), buyConfig, { thresholds: [0.5], includeLive: true });
    expect(all.scored).toBe('all');
    expect(all.intents[0]!.thresholds[0]).toMatchObject({ reveals: 2, correct: 1, precision: 0.5 });
  });

  it('replays end records, sorts each install by time, and skips intents without an outcome', () => {
    const shuffled = [...buyLog()].reverse();
    expect(replay(shuffled, buyConfig, { thresholds: [0.5] }).intents).toStrictEqual(
      replay(buyLog(), buyConfig, { thresholds: [0.5] }).intents,
    );
    const withTip: EngineConfig = {
      intents: {
        ...buyConfig.intents,
        tip: { prior: 0.1, priorStrength: 2, halfLife: 10, signals: { x: 1 } },
      },
    };
    const report = replay(buyLog(), withTip, { thresholds: [0.5] });
    expect(report.intents.map((i) => i.intent)).toStrictEqual(['buy']);
    expect(report.skipped).toStrictEqual([
      { intent: 'tip', reason: 'declares no outcome event, so there is nothing to score' },
    ]);
    // An end record closes the episode in replay exactly as endEpisode did on the device.
    const ended = replay(
      [
        ev('u1', 0, 'x'),
        { kind: 'end', installId: 'u1', mode: 'shadow', at: 5 },
        ev('u1', 10, 'x'),
      ],
      buyConfig,
      { thresholds: [0.5] },
    );
    expect(ended.records).toBe(3);
  });
});

// ---- fixture logs, written with the recorder exactly as an app would ----

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Session = { install: string; day: number; events: string[]; end?: boolean };

/** Three installs over twelve days: one upgrades, one browses and gets stuck, one reads help. */
const sessions: Session[] = [
  { install: 'install-a', day: 0, events: ['pricing.viewed', 'limit.hit'], end: true },
  {
    install: 'install-a',
    day: 1,
    events: [
      'pricing.viewed',
      'export.clicked',
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'search.empty',
      'help.opened',
      'help.article.read',
    ],
    end: true,
  },
  { install: 'install-a', day: 2, events: ['pricing.viewed', 'limit.hit'], end: true },
  { install: 'install-a', day: 3, events: ['pricing.viewed', 'app.opened'], end: true },
  {
    install: 'install-a',
    day: 4,
    events: ['pricing.viewed', 'limit.hit', 'export.clicked'],
    end: true,
  },
  { install: 'install-a', day: 5, events: ['app.opened', 'upgrade.completed'], end: true },
  { install: 'install-a', day: 11, events: ['app.opened'] },
  { install: 'install-b', day: 0, events: ['pricing.viewed', 'export.clicked'] },
  { install: 'install-b', day: 2, events: ['pricing.viewed', 'limit.hit'] },
  { install: 'install-b', day: 3, events: ['pricing.viewed', 'pricing.viewed', 'pricing.viewed'] },
  { install: 'install-b', day: 6, events: ['app.opened', 'plan.downgraded'] },
  {
    install: 'install-b',
    day: 8,
    events: [
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'search.empty',
      'search.empty',
    ],
  },
  { install: 'install-b', day: 12, events: ['app.opened'] },
  {
    install: 'install-c',
    day: 1,
    events: [
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'editor.undo',
      'search.empty',
      'help.opened',
      'help.article.read',
    ],
    end: true,
  },
  {
    install: 'install-c',
    day: 4,
    events: ['editor.undo', 'editor.undo', 'task.completed'],
    end: true,
  },
  { install: 'install-c', day: 7, events: ['pricing.viewed', 'limit.hit', 'pricing.viewed'] },
  { install: 'install-c', day: 12, events: ['app.opened'] },
];

/**
 * The log an app following the Shadow mode guide would write: observe, record, and in shadow mode
 * call markRevealed without showing anything. `modeOf` decides each record's mode.
 */
function writeLog(modeOf: (install: string, day: number) => RecordMode): string {
  const states = new Map<string, EngineState>();
  const lines: string[] = [];
  for (const { install, day, events, end } of sessions) {
    let s = states.get(install) ?? createState(config);
    const recording = { installId: install, mode: modeOf(install, day) };
    let at = T0 + day * DAY + 9 * 60 * MINUTE;
    for (const name of events) {
      at += 2 * MINUTE;
      const event = { name, at };
      s = observe(s, event);
      assertInvariants(s);
      lines.push(JSON.stringify(createRecord(s, event, recording)));
      for (const intent of Object.keys(config.intents)) {
        if (shouldReveal(s, intent, at)) {
          s = markRevealed(s, intent, at);
          assertInvariants(s);
        }
      }
    }
    if (end === true) {
      at += 5 * MINUTE;
      s = endEpisode(s, at);
      assertInvariants(s);
      lines.push(JSON.stringify(createEndRecord(at, recording)));
    }
    states.set(install, s);
  }
  return `${lines.join('\n')}\n`;
}

const logs = {
  shadow: writeLog(() => 'shadow'),
  // install-a's reveals go live from day 4.
  mixed: writeLog((install, day) => (install === 'install-a' && day >= 4 ? 'live' : 'shadow')),
  live: writeLog(() => 'live'),
};

/**
 * Deep equality with a tolerance on numbers. The fixture logs pin the recorder's output, but
 * Math.log1p and friends differ by an ulp between V8 versions (Node 22 and 24 disagree in the
 * sixteenth digit of a few decisions), so numbers are compared to 1e-12 and everything else,
 * key order included, exactly.
 */
function assertSameRecord(received: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number' && typeof received === 'number') {
    expect(received, path).toBeCloseTo(expected, 12);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(received), path).toBe(true);
    const items = received as unknown[];
    expect(items.length, path).toBe(expected.length);
    for (const [i, item] of expected.entries()) assertSameRecord(items[i], item, `${path}[${i}]`);
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(received, path).toBeTypeOf('object');
    const record = received as Record<string, unknown>;
    const keys = Object.keys(expected);
    expect(Object.keys(record), `${path} keys`).toStrictEqual(keys);
    for (const key of keys) {
      assertSameRecord(record[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return;
  }
  expect(received, path).toBe(expected);
}

describe('the fixture logs', () => {
  it('are what the recorder writes (the format is pinned by these files)', () => {
    // UPDATE_FIXTURES=1 npm test rewrites them after a deliberate change to the recorder.
    for (const [name, text] of Object.entries(logs)) {
      const file = `${fixtures}${name}.ndjson`;
      if (process.env.UPDATE_FIXTURES === '1') writeFileSync(file, text);
      const expectedLines = readFileSync(file, 'utf8').split('\n');
      const receivedLines = text.split('\n');
      expect(receivedLines.length, `${name}.ndjson: line count`).toBe(expectedLines.length);
      for (const [i, line] of receivedLines.entries()) {
        const expectedLine = expectedLines[i] as string;
        if (line === '' || expectedLine === '') {
          expect(line, `${name}.ndjson:${i + 1}`).toBe(expectedLine);
          continue;
        }
        assertSameRecord(JSON.parse(line), JSON.parse(expectedLine), `${name}.ndjson:${i + 1}`);
      }
    }
  });

  it('parse back into exactly the events and episode ends that were recorded', () => {
    const { entries, warnings } = parseLog(logs.shadow, 'shadow.ndjson');
    expect(warnings).toStrictEqual([]);
    const ends = sessions.filter((s) => s.end === true).length;
    const events = sessions.reduce((acc, s) => acc + s.events.length, 0);
    expect(entries.filter((e) => e.kind === 'end')).toHaveLength(ends);
    expect(entries.filter((e) => e.kind === 'event')).toHaveLength(events);
  });
});

// ---- the command, end to end over the files ----

function io(cwd = root) {
  const out = { stdout: '', stderr: '' };
  const value: Io = {
    stdout: (text) => {
      out.stdout += text;
    },
    stderr: (text) => {
      out.stderr += text;
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    cwd,
  };
  return { io: value, out };
}

const fixture = (name: string) => `tests/fixtures/replay/${name}`;
const replayArgs = (log: string, ...more: string[]) => [
  'replay',
  fixture(log),
  '--config',
  fixture('config.json'),
  ...more,
];

describe('oracular replay', () => {
  it('prints the report for a shadow log, with nothing on stderr', async () => {
    const { io: x, out } = io();
    expect(await run(replayArgs('shadow.ndjson'), x)).toBe(0);
    expect(out.stderr).toBe('');
    expect(out.stdout).toContain('oracular replay: 3 installs, ');
    expect(out.stdout).toContain("(the intent's reveal cooldown)");
    expect(out.stdout).toContain('| threshold | reveals | per user | precision | recall');
    expect(out.stdout).toContain('Brier score ');
    expect(out.stdout).toContain('tip: skipped, declares no outcome event');
  });

  it('the example in the Shadow mode guide is this exact output', async () => {
    const { io: x, out } = io();
    await run(replayArgs('shadow.ndjson', '--intent', 'upgrade', '--thresholds', '0.3,0.5,0.7'), x);
    const guide = readFileSync(`${root}docs/guide/shadow-mode.md`, 'utf8');
    const match = /<!-- replay:example -->\n```text\n([\s\S]*?)```\n<!-- \/replay:example -->/.exec(
      guide,
    );
    expect(match, 'docs/guide/shadow-mode.md has a replay:example block').not.toBeNull();
    expect(match![1]).toBe(out.stdout);
  });

  it('agrees with the pure replay, as JSON', async () => {
    const { io: x, out } = io();
    expect(await run(replayArgs('shadow.ndjson', '--json'), x)).toBe(0);
    const expected = replay(parseLog(logs.shadow, 'shadow.ndjson').entries, config);
    expect(JSON.parse(out.stdout)).toStrictEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('warns on a mixed log and scores only its shadow periods', async () => {
    const { io: x, out } = io();
    expect(await run(replayArgs('mixed.ndjson', '--json'), x)).toBe(0);
    expect(out.stderr).toMatch(/warning: the log mixes shadow and live records/);
    expect(JSON.parse(out.stdout).scored).toBe('shadow');
  });

  it('refuses a live-only log unless --include-live is given, and then warns', async () => {
    const refused = io();
    expect(await run(replayArgs('live.ndjson'), refused.io)).toBe(1);
    expect(refused.out.stdout).toBe('');
    expect(refused.out.stderr).toMatch(/every record in the log is live/);
    expect(refused.out.stderr).toMatch(/--include-live/);

    const included = io();
    expect(await run(replayArgs('live.ndjson', '--include-live'), included.io)).toBe(0);
    expect(included.out.stderr).toMatch(/warning: scoring \d+ live records as asked/);
    expect(included.out.stdout).toContain('Scored: every record, live included.');
  });

  it('names the file and line of a broken record', async () => {
    const lines = logs.shadow.split('\n');
    lines[2] = '{"v":1,"kind":"event","installId":"x","mode":"shadow","event":{"name":"a"}}';
    const { io: x, out } = io();
    x.readFile = (path) =>
      path.endsWith('.ndjson') ? lines.join('\n') : readFileSync(path, 'utf8');
    expect(await run(replayArgs('shadow.ndjson'), x)).toBe(1);
    expect(out.stderr).toBe(
      `oracular: ${fixture('shadow.ndjson')}:3: event.at must be a finite number\n`,
    );

    lines[2] = '{"v":2,"kind":"event"}';
    const v2 = io();
    v2.io.readFile = x.readFile;
    expect(await run(replayArgs('shadow.ndjson'), v2.io)).toBe(1);
    expect(v2.out.stderr).toMatch(
      /:3: recorder format v2 is not supported \(this replay reads v1\)/,
    );

    lines[2] = '{"v":1,"kind":"reveal","installId":"x","mode":"shadow","at":1}';
    const future = io();
    future.io.readFile = x.readFile;
    expect(await run(replayArgs('shadow.ndjson'), future.io)).toBe(0);
    expect(future.out.stderr).toMatch(/warning: .*skipped 1 record of unknown kind "reveal"/);
  });

  it('prints the version for replay and tune too, as the help says', async () => {
    for (const argv of [
      ['replay', '--version'],
      ['replay', '-v'],
      ['tune', '--version'],
    ]) {
      const x = io();
      expect(await run(argv, x.io), argv.join(' ')).toBe(0);
      expect(x.out.stdout).toMatch(/^\d+\.\d+\.\d+\S*\n$/);
      expect(x.out.stderr).toBe('');
    }
  });

  it('reports usage errors with exit code 2', async () => {
    const cases: Array<[string[], RegExp]> = [
      [['frobnicate'], /unknown command "frobnicate"/],
      [['replay'], /needs at least one log file/],
      [['replay', fixture('shadow.ndjson')], /needs --config/],
      [replayArgs('shadow.ndjson', '--window', 'soon'), /--window must be a positive duration/],
      [
        replayArgs('shadow.ndjson', '--thresholds', '0.5,1.5'),
        /--thresholds must be numbers between 0 and 1/,
      ],
      [
        replayArgs('shadow.ndjson', '--intent', 'nope'),
        /--intent nope: the config declares upgrade, stuck, tip/,
      ],
      [replayArgs('shadow.ndjson', '--bogus'), /unknown option --bogus/],
      [replayArgs('shadow.ndjson', '--json=yes'), /--json takes no value/],
      [
        ['replay', fixture('shadow.ndjson'), '--config', 'config.yaml'],
        /must be a \.json, \.js, \.mjs or \.cjs file/,
      ],
    ];
    for (const [argv, message] of cases) {
      const { io: x, out } = io();
      expect(await run(argv, x), argv.join(' ')).toBe(2);
      expect(out.stderr).toMatch(message);
      expect(out.stderr).toMatch(/Run "oracular --help" for usage/);
    }
  });

  it('scores an intent with no cooldown over its half-life and says so, unless --window is given', async () => {
    const noCooldown: EngineConfig = {
      ...config,
      intents: {
        ...config.intents,
        upgrade: { ...config.intents.upgrade!, reveal: { cooldown: 0 } },
      },
    };
    const readFile = (path: string) =>
      path.endsWith('config.json') ? JSON.stringify(noCooldown) : readFileSync(path, 'utf8');
    const fallback = io();
    fallback.io.readFile = readFile;
    expect(await run(replayArgs('shadow.ndjson'), fallback.io)).toBe(0);
    expect(fallback.out.stdout).toMatch(/the intent's half-life, since its reveal cooldown is 0/);
    const json = io();
    json.io.readFile = readFile;
    expect(await run(replayArgs('shadow.ndjson', '--json'), json.io)).toBe(0);
    expect(
      JSON.parse(json.out.stdout).intents.find((i: { intent: string }) => i.intent === 'upgrade'),
    ).toMatchObject({ window: noCooldown.intents.upgrade!.halfLife, windowSource: 'halfLife' });

    const given = io();
    given.io.readFile = readFile;
    expect(await run(replayArgs('shadow.ndjson', '--window', '7d', '--json'), given.io)).toBe(0);
    const upgrade = JSON.parse(given.out.stdout).intents.find(
      (i: { intent: string }) => i.intent === 'upgrade',
    );
    expect(upgrade).toMatchObject({ window: 7 * DAY, windowIsCooldown: false });
  });

  it('rejects an invalid config with exit code 1', async () => {
    const { io: x, out } = io();
    x.readFile = (path) =>
      path.endsWith('config.json') ? '{"intents":{}}' : readFileSync(path, 'utf8');
    expect(await run(replayArgs('shadow.ndjson'), x)).toBe(1);
    expect(out.stderr).toMatch(
      /is not a valid config: config\.intents must declare at least one intent/,
    );
  });

  it('ignores a top-level "$schema" key in a .json config', async () => {
    const plain = io();
    expect(await run(replayArgs('shadow.ndjson', '--json'), plain.io)).toBe(0);
    const pointing = io();
    pointing.io.readFile = (path) =>
      path.endsWith('config.json')
        ? JSON.stringify({
            $schema: 'https://yuribenjamin.github.io/oracular/config.schema.json',
            ...config,
          })
        : readFileSync(path, 'utf8');
    expect(await run(replayArgs('shadow.ndjson', '--json'), pointing.io)).toBe(0);
    expect(pointing.out.stderr).toBe('');
    expect(pointing.out.stdout).toBe(plain.out.stdout);
  });

  it('prints help and the version', async () => {
    const help = io();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.out.stdout).toMatch(/^Usage: oracular <command>/);
    expect(help.out.stdout).toMatch(/\n {2}replay /);
    expect(help.out.stdout).toMatch(/\n {2}tune /);
    const replayHelp = io();
    expect(await run(['replay', '--help'], replayHelp.io)).toBe(0);
    expect(replayHelp.out.stdout).toMatch(/^Usage: oracular replay/);
    const version = io();
    expect(await run(['--version'], version.io)).toBe(0);
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
    expect(version.out.stdout).toBe(`${pkg.version}\n`);
  });

  it('accepts durations with units and --opt=value', async () => {
    const { io: x, out } = io();
    expect(await run(replayArgs('shadow.ndjson', '--window=3d', '--json'), x)).toBe(0);
    for (const intent of JSON.parse(out.stdout).intents) expect(intent.window).toBe(3 * DAY);
  });
});

describe('a log of hundreds of thousands of records', () => {
  it("is read whole: spreading one file's entries into push overflowed the call stack", async () => {
    // 150,000 records over 50,000 installs. V8 refuses a spread of that many arguments, so before
    // the fix `oracular replay` and `oracular tune` died with "Maximum call stack size exceeded"
    // on any log past a hundred thousand lines or so, which a real shadow export reaches quickly.
    const lines: string[] = [];
    for (let j = 0; j < 50_000; j++) {
      const at = j * 1_000;
      const record = (name: string, t: number) =>
        JSON.stringify({
          v: 1,
          kind: 'event',
          installId: `u${j}`,
          mode: 'shadow',
          event: { name, at: t },
          decisions: {},
        });
      lines.push(
        record('x', at),
        record('x', at + 10),
        record(j % 2 === 0 ? 'buy.done' : 'noise', at + 50),
      );
    }
    const { io: real, out } = io();
    const virtual: Io = {
      ...real,
      readFile: (path) =>
        path.endsWith('big.ndjson')
          ? lines.join('\n')
          : path.endsWith('big.json')
            ? JSON.stringify(buyConfig)
            : real.readFile(path),
    };
    const args = ['replay', 'big.ndjson', '--config', 'big.json', '--thresholds', '0.5', '--json'];
    expect(await run(args, virtual)).toBe(0);
    expect(out.stderr).toBe('');
    const report = JSON.parse(out.stdout);
    expect(report.installs).toBe(50_000);
    expect(report.records).toBe(150_000);
  });
});

describe('DEFAULT_THRESHOLD', () => {
  it('is the reveal threshold the engine applies when none is configured', () => {
    // The CLI only sees the public API, so it keeps its own copy of the default to mark the
    // configured threshold. This pins the copy to the engine without exporting the constant.
    const intent = config.intents.upgrade!;
    expect(evidenceToReveal(intent)).toBe(
      evidenceToReveal(intent, { threshold: DEFAULT_THRESHOLD }),
    );
    expect(evidenceToReveal(intent)).not.toBe(
      evidenceToReveal(intent, { threshold: DEFAULT_THRESHOLD + 0.01 }),
    );
  });
});

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(null)).toBe('–');
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(45 * MINUTE)).toBe('45m');
    expect(formatDuration(90 * MINUTE)).toBe('1h 30m');
    expect(formatDuration(2 * DAY + 3 * 60 * MINUTE + 59_000)).toBe('2d 3h');
    expect(formatDuration(7 * DAY)).toBe('7d');
  });
});
