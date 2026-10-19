// The package declares react >=18 and develops on 19; this runs its tests on the floor. React 18
// is installed into a scratch directory outside the repository and named to vitest through
// ORACULAR_REACT_DIR, whose aliases send every React import in src and tests to that copy
// (react-dom finds the same `react` next to it by Node resolution). The workspace tree, package.json
// and the lockfile are untouched, and the directory is removed afterwards.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const REACT_18 = ['react@18.3.1', 'react-dom@18.3.1'];

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!/^npm_config_/i.test(key) && !/^npm_package_/i.test(key)) env[key] = value;
}

const dir = mkdtempSync(join(tmpdir(), 'oracular-react18-'));
try {
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      dir,
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      ...REACT_18,
    ],
    { env, stdio: 'inherit' },
  );
  const modules = join(dir, 'node_modules');
  const { version } = JSON.parse(readFileSync(join(modules, 'react', 'package.json'), 'utf8'));
  if (!version.startsWith('18.')) throw new Error(`react18: expected React 18, found ${version}`);
  execFileSync('npm', ['test'], {
    cwd: pkg,
    env: { ...env, ORACULAR_REACT_DIR: modules, ORACULAR_EXPECT_REACT: '18' },
    stdio: 'inherit',
  });
  console.log(`react18: tests pass on React ${version}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
