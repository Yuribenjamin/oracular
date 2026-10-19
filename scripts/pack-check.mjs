// Checks a package as npm would publish it: packs it once, asserts the exact file list, then
// runs publint (strict) and Are the Types Wrong against that same tarball.
//
// This runs inside `npm run check`, which itself runs inside `npm publish` (prepublishOnly). npm
// passes its own flags to child processes as npm_config_* variables, so they are scrubbed from
// every nested call. npm's output is never parsed (its --json shape differs between npm 10 and 12):
// the tarball is whatever .tgz lands in the destination directory. Nothing here needs the network:
// `npm pack` of a local directory, and both linters read the local .tgz (attw is told not to look
// up @types packages). Run as a script it checks the root; a workspace package imports
// `packCheck` and passes its own directory and file list.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Every file the root tarball must contain, and nothing else. */
export const EXPECTED_FILES = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/cli.js',
  'dist/index.cjs',
  'dist/index.cjs.map',
  'dist/index.d.cts',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'dist/inspect.cjs',
  'dist/inspect.cjs.map',
  'dist/inspect.d.cts',
  'dist/inspect.d.ts',
  'dist/inspect.js',
  'dist/inspect.js.map',
  'dist/presets.cjs',
  'dist/presets.cjs.map',
  'dist/presets.d.cts',
  'dist/presets.d.ts',
  'dist/presets.js',
  'dist/presets.js.map',
  'package.json',
  'schema/config.schema.json',
].sort();

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^npm_config_/i.test(key) && !/^npm_package_/i.test(key)) env[key] = value;
}

/**
 * Absolute path of a dev dependency's bin script, run with this Node rather than through a shim.
 * Looks in `dir`'s node_modules, then upward: a workspace package's dependencies are hoisted.
 */
function binOf(dir, pkg, name) {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', pkg);
    if (existsSync(join(candidate, 'package.json'))) {
      const { bin } = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
      return join(candidate, typeof bin === 'string' ? bin : bin[name]);
    }
    if (dirname(at) === at) throw new Error(`pack-check: ${pkg} is not installed above ${dir}`);
  }
}

/**
 * Packs the package at `dir`, asserts its tarball holds exactly `expectedFiles`, then runs publint
 * and attw on the tarball; `attw` holds extra arguments for attw (for example entrypoints to skip).
 */
export function packCheck({ dir, expectedFiles, attw = [] }) {
  const run = (label, args) => {
    console.log(`pack-check: ${label}`);
    execFileSync(process.execPath, args, { cwd: dir, env, stdio: 'inherit' });
  };

  const out = mkdtempSync(join(tmpdir(), 'oracular-pack-check-'));
  try {
    execFileSync('npm', ['pack', '--pack-destination', out], { cwd: dir, env, stdio: 'ignore' });
    const tarball = readdirSync(out).find((f) => f.endsWith('.tgz'));
    if (tarball === undefined) throw new Error(`pack-check: npm pack wrote no tarball into ${out}`);
    const tgz = join(out, tarball);

    const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith('/'))
      .map((line) => line.replace(/^package\//, ''))
      .sort();
    const missing = expectedFiles.filter((f) => !files.includes(f));
    const extra = files.filter((f) => !expectedFiles.includes(f));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `pack-check: the tarball's file list changed.\n  missing: ${missing.join(', ') || '(none)'}\n  unexpected: ${extra.join(', ') || '(none)'}\nUpdate the expected file list only if the change is intended.`,
      );
    }
    console.log(`pack-check: ${tarball} holds exactly the ${files.length} expected files`);

    run('publint --strict', [binOf(dir, 'publint', 'publint'), 'run', tgz, '--strict']);
    run('attw', [
      binOf(dir, '@arethetypeswrong/cli', 'attw'),
      tgz,
      '--no-definitely-typed',
      ...attw,
      '--format',
      'table',
    ]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The schema subpath is a JSON file with no types to check, and Node 10 resolution has no way
  // to resolve it; every JavaScript entrypoint is still checked under every resolution mode.
  packCheck({
    dir: root,
    expectedFiles: EXPECTED_FILES,
    attw: ['--exclude-entrypoints', './config.schema.json'],
  });
}
