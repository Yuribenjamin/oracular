// Checks the package as npm would publish it: packs it once, asserts the exact file list, then
// runs publint (strict) and Are the Types Wrong against that same tarball.
//
// This runs inside `npm run check`, which itself runs inside `npm publish` (prepublishOnly). npm
// passes its own flags to child processes as npm_config_* variables, so they are scrubbed from
// every nested call. npm's output is never parsed (its --json shape differs between npm 10 and 12):
// the tarball is whatever .tgz lands in the destination directory. Nothing here needs the network:
// `npm pack` of a local directory, and both linters read the local .tgz (attw is told not to look
// up @types packages).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Every file the published tarball must contain, and nothing else. */
export const EXPECTED_FILES = [
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
].sort();

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^npm_config_/i.test(key) && !/^npm_package_/i.test(key)) env[key] = value;
}

/** Absolute path of a dev dependency's bin script, run with this Node rather than through a shim. */
function binOf(pkg, name) {
  const dir = join(root, 'node_modules', pkg);
  const { bin } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return join(dir, typeof bin === 'string' ? bin : bin[name]);
}

function run(label, args) {
  console.log(`pack-check: ${label}`);
  execFileSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
}

const dir = mkdtempSync(join(tmpdir(), 'oracular-pack-check-'));
try {
  execFileSync('npm', ['pack', '--pack-destination', dir], { cwd: root, env, stdio: 'ignore' });
  const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (tarball === undefined) throw new Error(`pack-check: npm pack wrote no tarball into ${dir}`);
  const tgz = join(dir, tarball);

  const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''))
    .sort();
  const missing = EXPECTED_FILES.filter((f) => !files.includes(f));
  const extra = files.filter((f) => !EXPECTED_FILES.includes(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `pack-check: the tarball's file list changed.\n  missing: ${missing.join(', ') || '(none)'}\n  unexpected: ${extra.join(', ') || '(none)'}\nUpdate EXPECTED_FILES in scripts/pack-check.mjs only if the change is intended.`,
    );
  }
  console.log(`pack-check: ${tarball} holds exactly the ${files.length} expected files`);

  run('publint --strict', [binOf('publint', 'publint'), 'run', tgz, '--strict']);
  run('attw', [
    binOf('@arethetypeswrong/cli', 'attw'),
    tgz,
    '--no-definitely-typed',
    '--format',
    'table',
  ]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
