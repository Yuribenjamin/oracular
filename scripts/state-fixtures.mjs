// Writes tests/fixtures/state/<version>.json: a state serialized by a *published* version of
// oracular, so the test suite can prove every one of them still loads. Each version is fetched
// with `npm pack oracular@<version>` into a temporary directory outside the repository, imported
// from there, and run through the same fixed scenario. Nothing is written by hand.
//
//   node scripts/state-fixtures.mjs                 # every version in VERSIONS
//   node scripts/state-fixtures.mjs 0.2.1           # just one
//
// Needs the network (the registry); the test suite only reads the files it writes. The scenario
// uses nothing newer than the 0.1.0 API: createState, observe, endEpisode, markRevealed, serialize.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSIONS = ['0.1.0', '0.1.1', '0.1.2', '0.2.0', '0.2.1', '0.3.0'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T = 1_700_000_000_000;

/** The config every fixture was built with. Two intents, one of them with a repeating outcome. */
export const fixtureConfig = {
  episodeTimeout: 30 * MINUTE,
  learning: { priorEpisodes: 5 },
  reveal: { z: 1.28 },
  intents: {
    upgrade: {
      prior: 0.05,
      priorStrength: 10,
      halfLife: 7 * DAY,
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1, 'plan.downgraded': -4 },
      outcome: 'upgrade.completed',
    },
    checkout: {
      prior: 0.2,
      priorStrength: 5,
      halfLife: 2 * HOUR,
      signals: { 'cart.added': 2, 'product.viewed': 1, 'cart.emptied': -3 },
      outcome: 'checkout.completed',
      resetOnOutcome: false,
      reveal: { threshold: 0.6, z: 1.64, cooldown: 3 * HOUR },
    },
  },
};

/** The fixed scenario: three episodes, the last one still open, with repeats, outcomes and a reveal. */
export function runScenario(api) {
  const { createState, observe, endEpisode, markRevealed, serialize } = api;
  let s = createState(fixtureConfig);
  const at = (t, name) => {
    s = observe(s, { name, at: t });
  };

  // Episode 1, day 0: both outcomes arrive; one signal after the checkout outcome; ended explicitly.
  at(T, 'pricing.viewed');
  at(T + MINUTE, 'pricing.viewed');
  at(T + 2 * MINUTE, 'limit.hit');
  at(T + 3 * MINUTE, 'product.viewed');
  at(T + 4 * MINUTE, 'cart.added');
  at(T + 5 * MINUTE, 'checkout.completed');
  at(T + 6 * MINUTE, 'cart.added');
  at(T + 7 * MINUTE, 'upgrade.completed');
  s = endEpisode(s, T + 10 * MINUTE);

  // Episode 2, day 1: no outcome; closed by the idle timeout when episode 3 starts.
  const d1 = T + DAY;
  at(d1, 'export.clicked');
  at(d1 + MINUTE, 'plan.downgraded');
  at(d1 + 2 * MINUTE, 'product.viewed');
  at(d1 + 3 * MINUTE, 'product.viewed');

  // Episode 3: still open when serialized, with seen signals (some repeated) and a reveal.
  const e3 = d1 + 50 * MINUTE;
  at(e3, 'pricing.viewed');
  at(e3 + MINUTE, 'limit.hit');
  s = markRevealed(s, 'upgrade', e3 + MINUTE);
  at(e3 + 2 * MINUTE, 'cart.added');
  at(e3 + 3 * MINUTE, 'cart.added');
  at(e3 + 4 * MINUTE, 'product.viewed');
  at(e3 + 5 * MINUTE, 'cart.emptied');
  at(e3 + 6 * MINUTE, 'noise.event');

  return serialize(s);
}

async function fixtureFor(version) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^npm_config_/i.test(key) && !/^npm_package_/i.test(key)) env[key] = value;
  }
  const dir = mkdtempSync(join(tmpdir(), `oracular-${version}-`));
  try {
    execFileSync('npm', ['pack', `oracular@${version}`, '--pack-destination', dir], {
      env,
      stdio: 'ignore',
    });
    const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (tarball === undefined) throw new Error(`npm pack oracular@${version} wrote no tarball`);
    execFileSync('tar', ['-xzf', join(dir, tarball), '-C', dir]);
    const api = await import(pathToFileURL(join(dir, 'package', 'dist', 'index.js')).href);
    if (api.STATE_VERSION === undefined)
      throw new Error(`oracular@${version} has no STATE_VERSION`);
    return runScenario(api);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = fileURLToPath(new URL('../tests/fixtures/state/', import.meta.url));
  mkdirSync(out, { recursive: true });
  const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : VERSIONS;
  for (const version of versions) {
    const json = await fixtureFor(version);
    writeFileSync(join(out, `${version}.json`), json);
    console.log(`wrote tests/fixtures/state/${version}.json (${json.length} bytes)`);
  }
}
