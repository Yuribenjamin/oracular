// Runs the built `oracular` bin (dist/cli.js) on the fixture logs, as `npx oracular replay` would.
// No npm install: the bin imports 'oracular' through the package's own exports map, so this proves
// the published CLI runs on this Node (CI runs it on 18 and 20 as well).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) =>
  spawnSync(process.execPath, ['dist/cli.js', ...args], { cwd: root, encoding: 'utf8' });
const fixture = (name) => `tests/fixtures/replay/${name}`;

const version = cli('--version');
assert.equal(version.status, 0, version.stderr);
assert.match(version.stdout, /^\d+\.\d+\.\d+/);

const shadow = cli('replay', fixture('shadow.ndjson'), '--config', fixture('config.json'));
assert.equal(shadow.status, 0, shadow.stderr);
assert.equal(shadow.stderr, '');
assert.match(shadow.stdout, /^oracular replay: 3 installs/);
assert.match(shadow.stdout, /Brier score/);

const live = cli('replay', fixture('live.ndjson'), '--config', fixture('config.json'));
assert.equal(live.status, 1, 'a live-only log is refused');
assert.match(live.stderr, /every record in the log is live/);

assert.equal(cli('replay').status, 2, 'a usage error exits with 2');

console.log(`smoke ok (cli, node ${process.version})`);
