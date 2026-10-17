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
    expect(tables['priorStrength-table']).toContain('| 10 | 15.1 | 6 | 8 | 16 |');
    expect(tables['threshold-z-table']).toContain('| 0.5 | 0 | 9.0 | 3 |');
  });
});
