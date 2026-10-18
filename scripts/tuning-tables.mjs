// Renders the tuning tables in the docs from the library itself, so the two cannot disagree.
// `node scripts/tuning-tables.mjs --write` rewrites every marked region under docs/guide;
// tests/tuning-tables.test.ts fails when a region differs from what this renders.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createState, evidenceToReveal, observe, predict, shouldReveal } from 'oracular';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T = 1_700_000_000_000;

/** The quickstart intent, the running example of the docs. */
export const quickstart = {
  prior: 0.05,
  priorStrength: 10,
  halfLife: 7 * DAY,
  signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
  outcome: 'upgrade.completed',
};

/** Full-weight signals of weight `w` (distinct signals, or one per session) that first open the gate. */
export function signalsNeeded(needed, w) {
  return Number.isFinite(needed) ? String(Math.ceil(needed / w - 1e-9)) : '∞';
}

/** How many times one signal of weight `w`, repeated within a single session (sessions end after 30 idle minutes), takes to open the gate. */
export function repeatsNeeded(intent, w, max = 10_000) {
  let s = createState({
    episodeTimeout: 30 * MINUTE,
    intents: { x: { ...intent, signals: { s: w } } },
  });
  for (let n = 1; n <= max; n++) {
    s = observe(s, { name: 's', at: T });
    if (shouldReveal(s, 'x', T)) return String(n);
  }
  return `more than ${max.toLocaleString('en-US')}`;
}

const fixed = (x, digits) => x.toFixed(digits);
const yesNo = (b) => (b ? 'yes' : 'no');

/** The quickstart intent, n `pricing.viewed` in one session at one instant: what each adds and where p lands. */
function saturationRows() {
  const rows = [];
  let s = createState({ episodeTimeout: 30 * MINUTE, intents: { upgrade: quickstart } });
  let total = 0;
  for (let n = 1; n <= 32; n++) {
    s = observe(s, { name: 'pricing.viewed', at: T });
    const now = s.intents.upgrade.contributions['pricing.viewed'].alpha;
    const added = now - total;
    total = now;
    const { p, lower } = predict(s, 'upgrade', T);
    const fires = shouldReveal(s, 'upgrade', T);
    if (n <= 10 || fires) {
      rows.push(
        `| ${n} | ${fixed(added / 3, 3)} | ${fixed(added, 2)} | ${fixed(total, 2)} | ${fixed(p, 3)} | ${fixed(lower, 3)} | ${yesNo(fires)} |`,
      );
    }
    if (fires) break;
  }
  return rows;
}

/** The quickstart intent with `saturate: false`: every `pricing.viewed` adds its full 3. */
function fullWeightRows() {
  const rows = [];
  let s = createState({ intents: { upgrade: { ...quickstart, saturate: false } } });
  for (let n = 0; n <= 6; n++) {
    if (n > 0) s = observe(s, { name: 'pricing.viewed', at: T });
    const { alpha, beta } = s.intents.upgrade;
    const { p, sd, lower } = predict(s, 'upgrade', T);
    rows.push(
      `| ${n} | ${fixed(alpha, 1)} | ${fixed(beta, 1)} | ${fixed(p, 3)} | ${fixed(sd, 3)} | ${fixed(lower, 3)} | ${yesNo(shouldReveal(s, 'upgrade', T))} |`,
    );
  }
  return rows;
}

/** One `pricing.viewed` every `gap`, with sessions ending after 30 idle minutes: the signal count that first fires. */
function firesAfter(gap, max = 200) {
  let s = createState({ episodeTimeout: 30 * MINUTE, intents: { upgrade: quickstart } });
  for (let n = 1; n <= max; n++) {
    const at = T + (n - 1) * gap;
    s = observe(s, { name: 'pricing.viewed', at });
    if (shouldReveal(s, 'upgrade', at)) return `${n} signals`;
  }
  return 'never';
}

/** The transit example of the tuning guide. */
export const ride = {
  prior: 0.1,
  priorStrength: 8,
  halfLife: 3 * HOUR,
  signals: {
    'app.opened': 1,
    'departures.viewed': 2,
    'route.planned': 3,
    'ticket.bought': 4,
    'trip.cancelled': -3,
  },
  outcome: 'ride.started',
  reveal: { cooldown: 4 * HOUR },
};

/** The morning of the transit example, minutes after 07:00. A null name is a read without an event. */
export const morning = [
  [0, 'app.opened'],
  [2, 'departures.viewed'],
  [3, 'route.planned'],
  [6, 'ticket.bought'],
  [8, 'departures.viewed'],
  [9, 'route.planned'],
  [9 + 3 * 60, null],
  [9 + 12 * 60, null],
];

function clock(minutes) {
  const h = 7 + Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function rideRows() {
  let s = createState({ episodeTimeout: 30 * MINUTE, intents: { ride } });
  return morning.map(([minutes, name]) => {
    const at = T + minutes * MINUTE;
    if (name !== null) s = observe(s, { name, at });
    const { p, lower } = predict(s, 'ride', at);
    const label = name === null ? '(no event, read only)' : name;
    return `| ${clock(minutes)} | ${label} | ${fixed(p, 3)} | ${fixed(lower, 3)} | ${yesNo(shouldReveal(s, 'ride', at))} |`;
  });
}

/** Every table, keyed by the marker name used in the docs. */
export function renderTables() {
  const strengths = [5, 10, 20, 50];
  const byStrength = [
    '| priorStrength | evidence needed | weight 3 | weight 2 | weight 1 | one weight-3 signal repeated in one session |',
    '| ------------- | --------------- | -------- | -------- | -------- | ------------------------------------------- |',
    ...strengths.map((priorStrength) => {
      const intent = { ...quickstart, priorStrength };
      const needed = evidenceToReveal(intent);
      const cells = [3, 2, 1].map((w) => signalsNeeded(needed, w));
      return `| ${priorStrength} | ${needed.toFixed(1)} | ${cells.join(' | ')} | ${repeatsNeeded(intent, 3)} |`;
    }),
  ];

  const gates = [
    [0.3, 1.28],
    [0.5, 0],
    [0.5, 1.28],
    [0.5, 1.64],
    [0.5, 2],
    [0.7, 1.28],
    [0.9, 1.28],
  ];
  const byGate = [
    '| threshold | z | evidence needed | full-weight signals of weight 3 |',
    '| --------- | ---- | --------------- | ------------------------------- |',
    ...gates.map(([threshold, z]) => {
      const needed = evidenceToReveal(quickstart, { threshold, z });
      return `| ${threshold} | ${z} | ${needed.toFixed(1)} | ${signalsNeeded(needed, 3)} |`;
    }),
  ];

  const saturation = [
    '| repeat | share of the weight | adds | total from `pricing.viewed` | p | lower | fires |',
    '| ------ | ------------------- | ---- | --------------------------- | - | ----- | ----- |',
    ...saturationRows(),
  ];

  const fullWeight = [
    '| signals | α | β | p | sd | lower (p − 1.28·sd) | fires |',
    '| ------- | - | - | - | -- | ------------------- | ----- |',
    ...fullWeightRows(),
  ];

  const pacings = [
    ['all in one session', 0],
    ['one per session, an hour apart', HOUR],
    ['one per day', DAY],
    ['one every 3 days', 3 * DAY],
    ['one per week', 7 * DAY],
  ];
  const pacing = [
    '| `pricing.viewed` pacing (half-life 1 week, sessions end after 30 idle minutes) | fires after |',
    '| ------------------------------------------------------------------------------ | ----------- |',
    ...pacings.map(([label, gap]) => `| ${label} | ${firesAfter(gap)} |`),
  ];

  const rideTable = [
    '| time | event | p | lower | fires |',
    '| ---- | ----- | - | ----- | ----- |',
    ...rideRows(),
  ];

  return {
    'priorStrength-table': byStrength.join('\n'),
    'threshold-z-table': byGate.join('\n'),
    'saturation-table': saturation.join('\n'),
    'full-weight-table': fullWeight.join('\n'),
    'pacing-table': pacing.join('\n'),
    'ride-table': rideTable.join('\n'),
  };
}

const START = /<!-- generated:([A-Za-z-]+) -->\n/g;

/** Replaces each marked region in `markdown` with the rendered table of that name. */
export function applyTables(markdown, tables = renderTables()) {
  return markdown.replace(
    /<!-- generated:([A-Za-z-]+) -->\n(?:[\s\S]*?\n)?<!-- \/generated:\1 -->/g,
    (_whole, name) => {
      const table = tables[name];
      if (table === undefined) throw new Error(`no generator for table "${name}"`);
      return `<!-- generated:${name} -->\n${table}\n<!-- /generated:${name} -->`;
    },
  );
}

/** Markdown files under `dir` that contain at least one marker. */
export function markedFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...markedFiles(path));
    else if (entry.endsWith('.md') && START.test(readFileSync(path, 'utf8'))) out.push(path);
    START.lastIndex = 0;
  }
  return out.sort();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const write = process.argv.includes('--write');
  const tables = renderTables();
  for (const file of markedFiles(new URL('../docs/guide', import.meta.url).pathname)) {
    const before = readFileSync(file, 'utf8');
    const after = applyTables(before, tables);
    if (before === after) continue;
    if (write) {
      writeFileSync(file, after);
      console.log(`updated ${file}`);
    } else {
      console.log(`stale ${file} (run with --write)`);
      process.exitCode = 1;
    }
  }
  if (!write) console.log(Object.values(tables).join('\n\n'));
}
