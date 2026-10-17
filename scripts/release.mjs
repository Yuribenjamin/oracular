// Publishes with `changeset publish`, treating a 409 for the exact version being released as success.
//
// npm can answer 409 Conflict while a publish of the same version is still in its staging
// window. When that happens and the registry confirms the version is live, this script records
// the tag the Changesets action expects and exits 0 so the GitHub release is still created.
// Any other failure is passed through unchanged. Output is forwarded verbatim and the
// environment (including CHANGESETS_OUTPUT) is inherited, so the action's own detection of
// published packages keeps working.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Single-package repository: Changesets tags releases as vX.Y.Z.
const tag = `v${pkg.version}`;

let output = '';
const child = spawn('npx', ['changeset', 'publish'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
  shell: process.platform === 'win32',
});
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  output += chunk;
});
child.on('error', (error) => {
  console.error(`release: could not run changeset publish: ${error.message}`);
  process.exit(1);
});
child.on('close', (code) => {
  if (code === 0) process.exit(0);
  if (sawConflict(output) && isOnRegistry()) {
    console.log(
      `release: npm answered 409 for ${pkg.name}@${pkg.version} and the registry confirms it is live; treating the publish as done.`,
    );
    ensureTag();
    recordTag();
    process.exit(0);
  }
  process.exit(code ?? 1);
});

function sawConflict(text) {
  return /\bE409\b|\b409\b/.test(text);
}

function isOnRegistry() {
  try {
    const seen = execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return seen === pkg.version;
  } catch {
    return false;
  }
}

function ensureTag() {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'inherit' });
    console.log(`release: created tag ${tag}`);
  }
}

function recordTag() {
  const file = process.env.CHANGESETS_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ type: 'git-tag', tag, packageName: pkg.name })}\n`);
  console.log(`release: recorded ${tag} in ${file}`);
}
