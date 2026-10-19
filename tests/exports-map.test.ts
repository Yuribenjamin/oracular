import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
    // The presets subpath mirrors the main entry, condition for condition.
    const presets = pkg.exports['./presets'] as Record<string, unknown>;
    expect(Object.keys(presets)).toStrictEqual(['import', 'require', 'default']);
    expect(presets.import).toStrictEqual({
      types: './dist/presets.d.ts',
      default: './dist/presets.js',
    });
    expect(presets.require).toStrictEqual({
      types: './dist/presets.d.cts',
      default: './dist/presets.cjs',
    });
    expect(presets.default).toBe('./dist/presets.cjs');
    expect(Object.keys(pkg.exports)).toStrictEqual([
      '.',
      './presets',
      './config.schema.json',
      './package.json',
    ]);
    // TypeScript's node10 resolution ignores the exports map; typesVersions points it at the
    // subpath's declarations so an old tsconfig still gets types for 'oracular/presets'.
    expect(pkg.typesVersions).toStrictEqual({ '*': { presets: ['./dist/presets.d.ts'] } });
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
      // This test may itself run inside `npm publish` (prepublishOnly → check). npm passes its own
      // flags to child processes as npm_config_* variables, so scrub them from the nested call.
      // npm's own output is not parsed at all (its --json shape differs between npm 10 and 12):
      // the tarball is whatever .tgz landed in the destination directory.
      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!/^npm_config_/i.test(key) && !/^npm_package_/i.test(key)) env[key] = value;
      }
      execFileSync('npm', ['pack', '--pack-destination', dir], {
        cwd: root,
        env,
        stdio: 'ignore',
      });
      const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
      expect(tarball, `npm pack wrote no tarball into ${dir}`).toMatch(/^oracular-.*\.tgz$/);
      const shipped = JSON.parse(
        execFileSync('tar', ['-xOf', join(dir, tarball!), 'package/package.json'], {
          encoding: 'utf8',
        }),
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
