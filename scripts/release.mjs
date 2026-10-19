// Publishes with `changeset publish`, treating a 409 for a version being released as success.
//
// npm can answer 409 Conflict while a publish of the same version is still in its staging
// window. When that happens and the registry confirms every public package's version is live,
// this script records the tags the Changesets action expects for the packages that are not
// tagged yet, and exits 0 so the GitHub releases are still created. Any other failure is passed
// through unchanged. Output is forwarded verbatim and the environment (including
// CHANGESETS_OUTPUT) is inherited, so the action's own detection of published packages keeps
// working.
//
// npm-workspace repository: Changesets tags each package's release as name@version (see
// scripts/packages.mjs for the list; the root is itself the `oracular` workspace).
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isOnRegistry, publicPackages } from './packages.mjs';

const packages = publicPackages();

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
  if (sawConflict(output)) {
    const missing = packages.filter((p) => !isOnRegistry(p));
    if (missing.length === 0) {
      console.log(
        `release: npm answered 409 and the registry confirms every version is live (${packages.map((p) => p.tag).join(', ')}); treating the publish as done.`,
      );
      for (const p of packages) if (ensureTag(p)) recordTag(p);
      process.exit(0);
    }
    console.error(
      `release: npm answered 409 but ${missing.map((p) => p.tag).join(', ')} is not on the registry.`,
    );
  }
  process.exit(code ?? 1);
});

function sawConflict(text) {
  return /\bE409\b|\b409\b/.test(text);
}

/** Creates the package's release tag unless it exists; true when it was created here. */
function ensureTag({ tag }) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' });
    return false;
  } catch {
    execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'inherit' });
    console.log(`release: created tag ${tag}`);
    return true;
  }
}

function recordTag({ tag, name }) {
  const file = process.env.CHANGESETS_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ type: 'git-tag', tag, packageName: name })}\n`);
  console.log(`release: recorded ${tag} in ${file}`);
}
