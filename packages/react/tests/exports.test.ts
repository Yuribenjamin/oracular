import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src';

// A path, not a URL object: under the jsdom environment `URL` is jsdom's, which fs rejects.
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);

describe('@oracular/react packaging', () => {
  it('exports exactly the documented surface', () => {
    expect(Object.keys(api).sort()).toStrictEqual([
      'IntentProvider',
      'asyncStorageAdapter',
      'createIntentStore',
      'flushOnBackground',
      'localStorageAdapter',
      'mmkvAdapter',
      'useIntent',
      'useIntentContext',
      'useIntentSelector',
      'useIntentStore',
      'usePrediction',
    ]);
  });

  it('mirrors the root exports map condition for condition, and declares only peers', () => {
    expect(Object.keys(pkg.exports)).toStrictEqual(['.', './package.json']);
    expect(pkg.exports['.']).toStrictEqual({
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
      default: './dist/index.cjs',
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toStrictEqual({ oracular: '>=0.8.0 <2', react: '>=18' });
    expect(pkg.files).toStrictEqual(['dist', 'README.md', 'CHANGELOG.md', 'LICENSE']);
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.publishConfig).toStrictEqual({ access: 'public' });
  });
});
