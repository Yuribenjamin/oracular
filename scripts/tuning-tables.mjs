// Renders the tuning tables in the docs from the library itself, so the two cannot disagree.
// `node scripts/tuning-tables.mjs --write` rewrites every marked region under docs/guide;
// tests/tuning-tables.test.ts fails when a region differs from what this renders.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceToReveal } from 'oracular';

const DAY = 24 * 60 * 60 * 1000;

/** The quickstart intent, the running example of the docs. */
export const quickstart = {
  prior: 0.05,
  priorStrength: 10,
  halfLife: 7 * DAY,
  signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
  outcome: 'upgrade.completed',
};

/** Identical signals of weight `w`, fired together, that first open the gate. */
export function signalsNeeded(needed, w) {
  return Number.isFinite(needed) ? String(Math.ceil(needed / w - 1e-9)) : '∞';
}

/** Every table, keyed by the marker name used in the docs. */
export function renderTables() {
  const strengths = [5, 10, 20, 50];
  const byStrength = [
    '| priorStrength | evidence needed | weight 3 | weight 2 | weight 1 |',
    '| ------------- | --------------- | -------- | -------- | -------- |',
    ...strengths.map((priorStrength) => {
      const needed = evidenceToReveal({ ...quickstart, priorStrength });
      const cells = [3, 2, 1].map((w) => signalsNeeded(needed, w));
      return `| ${priorStrength} | ${needed.toFixed(1)} | ${cells.join(' | ')} |`;
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
    '| threshold | z | evidence needed | signals of weight 3 |',
    '| --------- | ---- | --------------- | ------------------- |',
    ...gates.map(([threshold, z]) => {
      const needed = evidenceToReveal(quickstart, { threshold, z });
      return `| ${threshold} | ${z} | ${needed.toFixed(1)} | ${signalsNeeded(needed, 3)} |`;
    }),
  ];

  return {
    'priorStrength-table': byStrength.join('\n'),
    'threshold-z-table': byGate.join('\n'),
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
