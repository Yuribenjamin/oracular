// The package as npm would publish it: exact file list, publint, attw. See scripts/pack-check.mjs
// at the root for the shared check.
import { fileURLToPath } from 'node:url';
import { packCheck } from '../../../scripts/pack-check.mjs';

packCheck({
  dir: fileURLToPath(new URL('../', import.meta.url)),
  expectedFiles: [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.cjs.map',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/index.js.map',
    'package.json',
  ].sort(),
});
