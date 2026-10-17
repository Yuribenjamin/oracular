import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dot = pkg.exports['.'] as Record<string, unknown>;

/**
 * The exports resolution algorithm as Node and bundlers implement it: walk the condition object's
 * keys in order and take the first key that is an active condition or "default"; recurse into
 * nested objects; a string is the answer. Key order is therefore part of the contract.
 */
function resolveConditions(target: unknown, conditions: readonly string[]): string | null {
  if (typeof target === 'string') return target;
  if (target === null || typeof target !== 'object') return null;
  for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
    if (key === 'default' || conditions.includes(key)) {
      const resolved = resolveConditions(value, conditions);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

describe('package.json exports', () => {
  it('lists import, require, then default, with default as the CommonJS fallback', () => {
    expect(Object.keys(dot)).toStrictEqual(['import', 'require', 'default']);
    expect(dot.import).toStrictEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
    expect(dot.require).toStrictEqual({ types: './dist/index.d.cts', default: './dist/index.cjs' });
    expect(dot.default).toBe('./dist/index.cjs');
    // TypeScript requires "types" to come first inside each branch.
    expect(Object.keys(dot.import as object)[0]).toBe('types');
    expect(Object.keys(dot.require as object)[0]).toBe('types');
    expect(pkg.exports['./package.json']).toBe('./package.json');
  });

  it('resolves to the right file for each kind of consumer', () => {
    expect(resolveConditions(dot, ['node', 'require'])).toBe('./dist/index.cjs'); // Node require()
    expect(resolveConditions(dot, ['node', 'import'])).toBe('./dist/index.js'); // Node import
    expect(resolveConditions(dot, ['browser', 'import'])).toBe('./dist/index.js'); // bundlers
    expect(resolveConditions(dot, ['browser'])).toBe('./dist/index.cjs'); // Jest jsdom: browser + default
    expect(resolveConditions(dot, ['browser', 'default'])).toBe('./dist/index.cjs');
    expect(resolveConditions(dot, [])).toBe('./dist/index.cjs'); // nothing but default
    expect(resolveConditions(dot, ['types', 'import'])).toBe('./dist/index.d.ts');
    expect(resolveConditions(dot, ['types', 'require'])).toBe('./dist/index.d.cts');
  });

  it('is shipped with the same key order: npm pack does not reorder it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracular-pack-'));
    try {
      const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const tarball = join(dir, out.split('\n').pop() ?? '');
      const shipped = JSON.parse(
        execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
      );
      expect(JSON.stringify(shipped.exports)).toBe(JSON.stringify(pkg.exports));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('import.meta.resolve in a real Node ESM process lands on the ESM build', () => {
    const resolved = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "console.log(import.meta.resolve('oracular'))"],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    expect(resolved).toMatch(/\/dist\/index\.js$/);
  });
});
