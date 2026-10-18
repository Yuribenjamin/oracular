import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyTables, markedFiles, renderTables } from '../scripts/tuning-tables.mjs';

const guide = fileURLToPath(new URL('../docs/guide', import.meta.url));

describe('tuning tables in the docs', () => {
  it('are exactly what evidenceToReveal renders', () => {
    const tables = renderTables();
    const files = markedFiles(guide);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(
        applyTables(text, tables),
        `${file} is stale: run node scripts/tuning-tables.mjs --write`,
      ).toBe(text);
      for (const [name, table] of Object.entries(tables)) {
        if (text.includes(`<!-- generated:${name} -->`)) {
          expect(text, `${file}: region ${name} must contain the rendered table`).toContain(table);
        }
      }
    }
  });

  it('render the numbers the guide quotes in prose', () => {
    const tables = renderTables();
    expect(tables['priorStrength-table']).toContain('| 10 | 15.1 | 6 | 8 | 16 | 32 |');
    expect(tables['threshold-z-table']).toContain('| 0.5 | 0 | 9.0 | 3 |');
    // Signals & weights, Intents & priors, Reveal & confidence: p crosses 0.5 at the third
    // full-weight signal, the lower bound at the sixth (α = 18.5, sd 0.088, p 0.66).
    expect(tables['full-weight-table']).toContain('| 3 | 9.5 | 9.5 | 0.500 |');
    expect(tables['full-weight-table']).toContain(
      '| 6 | 18.5 | 9.5 | 0.661 | 0.088 | 0.548 | yes |',
    );
    // Saturation: six repeats add 8.42, the gate opens at the 32nd; a repeat of weight 3 adds 1.75.
    expect(tables['saturation-table']).toContain('| 2 | 0.585 | 1.75 | 4.75 |');
    expect(tables['saturation-table']).toContain('| 6 | 0.222 | 0.67 | 8.42 |');
    expect(tables['saturation-table']).toMatch(/\| 32 \| [^\n]* \| yes \|/);
    // Tuning guide: pacing and the transit morning.
    expect(tables['pacing-table']).toContain('| all in one session | 32 signals |');
    expect(tables['pacing-table']).toContain('| one per day | 7 signals |');
    expect(tables['pacing-table']).toContain('| one every 3 days | never |');
    expect(tables['ride-table']).toContain('| 07:08 | departures.viewed | 0.621 | 0.482 | no |');
    expect(tables['ride-table']).toContain('| 07:09 | route.planned | 0.652 | 0.522 | yes |');
    expect(tables['ride-table']).toContain('| 10:09 | (no event, read only) | 0.499 |');
    expect(tables['ride-table']).toContain('| 19:09 | (no event, read only) | 0.181 |');
    // What oracular can and cannot learn: the predictive weight holds (2.02), the noise one fades
    // to 0.63; a once-per-user signal erodes before the outcome (lowest at 7 of 10) except when
    // present in every session; correlated signals reveal in 5 sessions instead of 13, in either
    // order; Monday's signals take a miss for Tuesday's upgrade.
    expect(tables['repeating-outcome-table']).toContain('| 30 | 12 / 6 | 2.02 | 6 / 9 | 0.63 |');
    expect(tables['once-per-user-table']).toContain('| 7 of 10 | 2.02 |');
    expect(tables['once-per-user-table']).toContain('| 10 of 10 | 3.00 | 3.00 |');
    const eroded = [...tables['once-per-user-table']!.matchAll(/\| \d+ of 10 \| ([\d.]+) \|/g)].map(
      (m) => Number(m[1]),
    );
    expect(Math.min(...eroded)).toBe(2.02);
    expect(tables['independence-table']).toMatch(/alone, weight 2 \| 0\.208 \| 13 \|/);
    expect(tables['independence-table']).toMatch(/always together \| 0\.321 \| 5 \|/);
    expect(tables['independence-table']).toMatch(/then `a` \| 0\.321 \| 5 \|/);
    expect(tables['attribution-table']).toContain('| pricing.viewed | Monday | 0 | 1 |');
    expect(tables['attribution-table']).toContain('| export.clicked | Tuesday | 1 | 0 |');
    // The second departures.viewed (weight 2) adds 1.17; the README's 3.46 for ten repeats.
    expect((2 * Math.log2(3 / 2)).toFixed(2)).toBe('1.17');
    expect(Math.log2(11).toFixed(2)).toBe('3.46');
    expect([2, 3, 4].map((n) => Math.log2(1 + 1 / n).toFixed(2))).toStrictEqual([
      '0.58',
      '0.42',
      '0.32',
    ]);
  });
});
