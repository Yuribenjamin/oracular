// The packages this repository publishes: the root, which is itself the `oracular` workspace, and
// every non-private package the root's `workspaces` globs name. scripts/release.mjs tags them as
// Changesets does, `name@version`, and the release workflow asks which are not on npm yet:
//
//   node scripts/packages.mjs                 # name@version of every public package
//   node scripts/packages.mjs --unpublished   # the directories whose version is not on npm yet
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function readPackage(dir) {
  const file = join(dir, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

/** The root, then the directories the root's `workspaces` name: "x/*" is every child of x. */
function workspaceDirs(rootPkg) {
  const out = [root];
  for (const entry of rootPkg.workspaces ?? []) {
    if (entry === '.') continue;
    if (entry.endsWith('/*')) {
      const parent = join(root, entry.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const child of readdirSync(parent, { withFileTypes: true })) {
        if (child.isDirectory()) out.push(join(parent, child.name));
      }
    } else {
      out.push(join(root, entry));
    }
  }
  return out;
}

/** Every public package in the workspace, with the tag Changesets gives its release. */
export function publicPackages() {
  const out = [];
  for (const dir of workspaceDirs(readPackage(root))) {
    const pkg = readPackage(dir);
    if (pkg === undefined || pkg.private === true || pkg.name === undefined) continue;
    out.push({
      name: pkg.name,
      version: pkg.version,
      dir,
      relativeDir: relative(root, dir) || '.',
      tag: `${pkg.name}@${pkg.version}`,
    });
  }
  return out;
}

/** Whether the registry already has this exact version. */
export function isOnRegistry({ name, version }) {
  try {
    const seen = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return seen === version;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const unpublished = process.argv.includes('--unpublished');
  const list = publicPackages().filter((p) => !unpublished || !isOnRegistry(p));
  console.log(list.map((p) => (unpublished ? p.relativeDir : p.tag)).join(' '));
}
