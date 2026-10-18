// Renders the tuning tables in the docs from the library itself, so the two cannot disagree.
// `node scripts/tuning-tables.mjs --write` rewrites every marked region under docs/guide;
// tests/tuning-tables.test.ts fails when a region differs from what this renders.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createState,
  endEpisode,
  evidenceToReveal,
  explain,
  observe,
  predict,
  shouldReveal,
} from 'oracular';

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

// ---- What oracular can and cannot learn ----

/** One session: the given events a minute apart, then the session ends. */
function session(state, at, events) {
  let s = state;
  let t = at;
  for (const name of events) {
    s = observe(s, { name, at: t });
    t += MINUTE;
  }
  return endEpisode(s, t);
}

const row = (state, intent, signal, at) =>
  explain(state, intent, at).find((r) => r.signal === signal);

/**
 * A repeating outcome: checkout, once a day for 30 days. cart.added is seen in three sessions out
 * of five and is followed by a checkout in two of those three; product.viewed is seen every other
 * session whatever happens. Both start at weight 2.
 */
function repeatingRows() {
  const intent = {
    prior: 0.2,
    priorStrength: 5,
    halfLife: 2 * HOUR,
    signals: { 'cart.added': 2, 'product.viewed': 2 },
    outcome: 'checkout.completed',
  };
  let s = createState({ intents: { checkout: intent } });
  const rows = [];
  for (let day = 0; day < 30; day++) {
    const events = ['app.opened'];
    const cart = day % 5 < 3;
    if (cart) events.push('cart.added');
    if (day % 2 === 0) events.push('product.viewed');
    if ((cart && day % 5 !== 2) || day % 10 === 9) events.push('checkout.completed');
    s = session(s, T + day * DAY, events);
    if ([5, 10, 20, 30].includes(day + 1)) {
      const at = T + (day + 1) * DAY;
      const cell = (signal) => {
        const r = row(s, 'checkout', signal, at);
        return `${fixed(r.hits, 0)} / ${fixed(r.misses, 0)} | ${fixed(r.effectiveWeight, 2)}`;
      };
      rows.push(`| ${day + 1} | ${cell('cart.added')} | ${cell('product.viewed')} |`);
    }
  }
  return rows;
}

/**
 * A once-per-user outcome: the quickstart upgrade. Ten sessions without an upgrade, the signal
 * seen in the first k of them; then an eleventh session with the signal and the upgrade.
 */
function oncePerUserRows() {
  return [1, 3, 5, 7, 9, 10].map((k) => {
    let s = createState({ intents: { upgrade: quickstart } });
    for (let i = 0; i < 10; i++) {
      s = session(s, T + i * DAY, i < k ? ['pricing.viewed'] : ['app.opened']);
    }
    const before = row(s, 'upgrade', 'pricing.viewed', T + 10 * DAY).effectiveWeight;
    s = session(s, T + 10 * DAY, ['pricing.viewed', 'upgrade.completed']);
    const after = row(s, 'upgrade', 'pricing.viewed', T + 11 * DAY).effectiveWeight;
    return `| ${k} of 10 | ${fixed(before, 2)} | ${fixed(after, 2)} |`;
  });
}

/** Signals add: two that always fire together count twice, and their order does not matter. */
function independenceRows() {
  const intent = (signals) => ({ prior: 0.05, priorStrength: 10, halfLife: 7 * DAY, signals });
  const daysToReveal = (signals, events) => {
    let s = createState({ episodeTimeout: 30 * MINUTE, intents: { x: intent(signals) } });
    for (let day = 0; day < 60; day++) {
      let at = T + day * DAY;
      for (const name of events) {
        s = observe(s, { name, at });
        at += MINUTE;
      }
      if (shouldReveal(s, 'x', at)) return `${day + 1}`;
    }
    return 'never';
  };
  const pAfter = (events) => {
    let s = createState({ intents: { x: intent({ a: 2, b: 2 }) } });
    for (const name of events) s = observe(s, { name, at: T });
    return fixed(predict(s, 'x', T).p, 3);
  };
  return [
    `| \`a\` alone, weight 2 | ${pAfter(['a'])} | ${daysToReveal({ a: 2 }, ['a'])} |`,
    `| \`a\` then \`b\`, weight 2 each, always together | ${pAfter(['a', 'b'])} | ${daysToReveal({ a: 2, b: 2 }, ['a', 'b'])} |`,
    `| \`b\` then \`a\` | ${pAfter(['b', 'a'])} | ${daysToReveal({ a: 2, b: 2 }, ['b', 'a'])} |`,
  ];
}

/** Per-episode attribution: Monday's signals get a miss when the upgrade comes on Tuesday. */
function attributionRows() {
  let s = createState({ intents: { upgrade: quickstart } });
  s = session(s, T, ['pricing.viewed', 'limit.hit']);
  s = session(s, T + DAY, ['export.clicked', 'upgrade.completed']);
  const at = T + 2 * DAY;
  return [
    ['pricing.viewed', 'Monday'],
    ['limit.hit', 'Monday'],
    ['export.clicked', 'Tuesday'],
  ].map(([signal, day]) => {
    const r = row(s, 'upgrade', signal, at);
    return `| ${signal} | ${day} | ${fixed(r.hits, 0)} | ${fixed(r.misses, 0)} |`;
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

  const repeating = [
    '| sessions | `cart.added` hits / misses | effective | `product.viewed` hits / misses | effective |',
    '| -------- | -------------------------- | --------- | ------------------------------ | --------- |',
    ...repeatingRows(),
  ];
  const oncePerUser = [
    '| sessions with `pricing.viewed` | effective weight, no upgrade yet | after one upgrade |',
    '| ----------------------------- | -------------------------------- | ----------------- |',
    ...oncePerUserRows(),
  ];
  const independence = [
    '| signals in each session | p after one session | sessions to the reveal, one a day |',
    '| ----------------------- | ------------------- | --------------------------------- |',
    ...independenceRows(),
  ];
  const attribution = [
    '| signal | seen on | hits | misses |',
    '| ------ | ------- | ---- | ------ |',
    ...attributionRows(),
  ];

  return {
    'repeating-outcome-table': repeating.join('\n'),
    'once-per-user-table': oncePerUser.join('\n'),
    'independence-table': independence.join('\n'),
    'attribution-table': attribution.join('\n'),
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
