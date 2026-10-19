# Contributing to oracular

Thanks for taking the time. This document covers the development setup, how the repository and
tests are organised, the rules that keep the engine trustworthy, and how releases happen.

## Development setup

The library runs on Node 18+, but the development toolchain (vitest, tsup, Biome, VitePress)
needs Node 22 or newer. `.nvmrc` pins it.

```sh
nvm use          # Node 22
npm ci           # exact versions from package-lock.json
npm run check    # lint, typecheck, tests, build, smoke, size, pack check: everything CI runs
```

Individual steps:

| Command                 | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `npm run lint`          | Biome lint + format check (`npm run format` to fix)           |
| `npm run typecheck`     | `tsc` over `src/` against the ES2020 library only, `cli/` with Node types, then tests |
| `npm test`              | vitest, once (`npm run test:watch` to iterate)                |
| `npm run build`         | tsup → `dist/`: the main entry and the bin, then `oracular/presets`, then `oracular/inspect` (each ESM, CJS, `.d.ts`); the subpaths build in turn so a build running at the same time can never clean their declarations away |
| `npm run smoke`         | runs the built output through the `exports` map in CJS and ESM, and the bin on the fixture logs |
| `npm run size`          | size-limit: min+gzip size of the ESM build against the budget in `.size-limit.json` |
| `npm run pack:check`    | packs the package, asserts the exact file list, runs publint (strict) and attw on the tarball |
| `npm run docs:dev`      | the documentation site locally (regenerates the API reference first) |
| `npm run docs:build`    | builds the site; dead links fail the build                    |
| `npm run docs:gif`      | re-records `assets/inspector.gif` from the React example on its virtual clock, through the system Chrome (`playwright-core`, no browser download); deterministic on one machine, fonts differ across OSes |

`npm ls react` lists two copies on purpose: VitePress depends on `@docsearch/react`, whose peer
range pins React below 19, so npm hoists React 18 to the root and nests the React 19 that
`packages/react` and the example develop against; the root `overrides` entry for `@types/react`
exists for the same reason, so that one set of React types serves the whole tree. Neither should
be "fixed" here; both disappear on their own once that peer range admits React 19.

## Repository layout

```
src/            the library (zero runtime dependencies, no I/O of any kind)
  index.ts      public exports only; the exports test pins this list
  types.ts      public types; their JSDoc is the API reference
  config.ts     validation and normalisation of config, events and options
  math.ts       decay, Beta mean/variance, Laplace smoothing, lift
  intent.ts     α/β bookkeeping; withContributions is the only place α and β are written
  learning.ts   hit/miss records, episode counts, learned and effective weights
  attribution.ts episodes waiting for the outcome under IntentConfig.attribution: hold, credit, settle
  episode.ts    episode bookkeeping (seen signals, resolution, timeout)
  observe.ts    observe and endEpisode
  predict.ts    predict, shouldReveal, markRevealed
  explain.ts    explain
  serialize.ts  serialize, deserialize, config swap
  migrate.ts    the built-in state migrations (version 1 → 2 → 3)
  recorder.ts   createRecord, createEndRecord: the recorder format
  validate.ts   validateConfig
  units.ts      ms, durations in milliseconds
  presets.ts    the `oracular/presets` entry: four starting configs and where their numbers come from
  inspect.ts    the `oracular/inspect` entry: renderInspector and mountInspector, an HTML view of
                the snapshot `inspect` (main entry) returns; no DOM API, no timer, no engine code
cli/            the `oracular` bin (`oracular replay`, `oracular tune`): Node only, compiled with
                tsconfig.cli.json, not part of the library; it imports 'oracular' like any user,
                plus `lift` and `laplace` from src/math.ts so its numbers are the engine's
tests/          vitest suites, one per area, plus helpers.ts
  fixtures/     states saved by every published version, and the replay fixture logs
examples/       quickstart.ts: the README's first code block, byte for byte; retailrocket/: the
                converter and scripts behind the clickstream case study (the data is not here);
                react-vite/: a private workspace member, the upgrade preset on a pricing page with
                the inspector beside it, built by `check` and never published
packages/react/ `@oracular/react`: the store, the hook, the provider and the persistence adapters,
                a workspace package with its own version, changelog, tests, smoke, size budget and
                pack check, and `oracular` as a peer dependency
scripts/        smoke scripts run against dist/ in CI on Node 18 and 20, pack-check, the
                generated docs tables, and the state fixture generator
schema/         config.schema.json, the JSON Schema for the config: published in the tarball and
                copied to docs/public byte for byte (tests/schema.test.ts checks both, and pins
                the schema's keys and bounds to src/config.ts)
docs/           VitePress site; docs/api is generated by TypeDoc and not committed
assets/         logo; not published to npm
```

`tsconfig.json` compiles `src/` with `lib: ["ES2020"]` and `types: []`. If something in `src/`
needs a DOM or Node API, the typecheck fails on purpose: the engine must run unchanged in
browsers, Node and React Native.

## Tests

- Every public function is pure. `tests/purity.test.ts` deep-freezes inputs, calls each
  function twice and checks deep-equal output and untouched inputs.
- `tests/property.test.ts` generates configs and event traces with fast-check (200 runs per
  property, fixed seed) and checks the properties the stability page lists: purity, monotone
  decay, the α/β invariant, serialize/deserialize identity and the reveal gate.
  `PROPERTY_SEED=<n> npm test` runs them with another seed; a failure prints the seed and the
  shrunk counterexample.
- `tests/helpers.ts` exports `assertInvariants(state)`. It checks, for every intent, that
  α = α₀ + Σ contributions.alpha and β = β₀ + Σ contributions.beta within 1e-9, that every
  number is finite and p is in [0, 1], that no undeclared signal or intent key exists anywhere
  in the state, and that the state is plain JSON. **Call it after every operation that returns
  a state** (`observe`, `endEpisode`, `markRevealed`, `deserialize`). If it fails, the engine
  has a bug. Fix the engine; do not loosen the check.
- `tests/readme.test.ts` asserts that the README's first code block is under 15 lines and
  byte-identical to `examples/quickstart.ts`, and runs that file. Change both together.
- `tests/exports.test.ts` pins the public surface. Adding an export is an API decision; say so
  in the PR.
- `tests/state-fixtures.test.ts` loads a state saved by every published version (from
  `tests/fixtures/state/`) and checks that it migrates. The files are written by
  `node scripts/state-fixtures.mjs` from the real published tarballs, never by hand; after a
  release, add the new version to `VERSIONS` there and run it.
- `tests/fixtures/replay/*.ndjson` are written by the recorder inside `tests/replay.test.ts` and
  compared with a 1e-12 tolerance on numbers, because V8 versions differ by an ulp in `Math`
  results. After a deliberate change to the recorder, `UPDATE_FIXTURES=1 npm test` rewrites them.
- `tests/deserialize-fuzz.test.ts` feeds `deserialize` truncated, corrupted and tampered states.
  It must only ever throw `SyntaxError`, `TypeError` or `RangeError`, or load a state whose
  estimates stay finite.
- Numeric tables in the docs are generated: `node scripts/tuning-tables.mjs --write` renders every
  `<!-- generated:… -->` region from the library, and a test fails when one is stale.

Prefer exact expectations (`toBe`, `toStrictEqual`, `toBeCloseTo(x, 12)`) over loose ones. When
a test fails, show the failure in the PR discussion rather than widening the tolerance.

## Changing the math

A change to any formula (decay, learned weight, blend, lift, confidence bound, cooldowns) needs
all three of:

1. a test that pins the new behaviour with concrete numbers,
2. the matching update to the README's "How it works" section and the concept page under
   `docs/guide/concepts/`,
3. a changeset (see below) so the change is released and lands in the CHANGELOG.

`explain()` must keep adding up: the sum of per-signal contributions equals α − α₀ and β − β₀.

A change to the shape of the state bumps `STATE_VERSION` and ships its migration in
`src/migrate.ts`, so that `deserialize` upgrades stored states without the app's help; the
fixtures of every published version must keep loading.

## Changesets

Releases are driven by [Changesets](https://github.com/changesets/changesets). If your pull
request changes behaviour, add a changeset and commit the generated file with your change:

```sh
npm run changeset
```

Pick the bump, then write the entry for people who use the library. While the version is
**0.x**, a change that could break an existing integration is a **minor** bump, and so is a new
feature; fixes and changes nobody has to react to are **patch**. Pull requests without behaviour
changes (docs, CI, tests, refactors with identical output) need no changeset; the advisory
"Changeset present" check on PRs will note the absence, and that is fine.

## Commit messages

Plain [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
`test:`, `chore:`, `build:`, `ci:`, `refactor:`. One logical change per commit. No trailers.

## Pull request checklist

- [ ] `npm run check` passes locally
- [ ] new behaviour has tests; `assertInvariants` is called after every state-returning operation
- [ ] public JSDoc updated (`@param`, `@returns`, `@throws`, `@example`): it is the API reference
- [ ] README and concept pages updated if the model changed
- [ ] a changeset if behaviour changed (`npm run changeset`)
- [ ] no new runtime dependency, no I/O, no `Date.now()` inside `src/`
- [ ] `npm run size` passes. The budgets in `.size-limit.json` are the size at the last release
      plus about 10%; raising one is a decision to state, with the numbers, in the PR
- [ ] `npm run pack:check` passes; if the published file list changes on purpose, update
      `EXPECTED_FILES` in `scripts/pack-check.mjs` and say why in the PR

## Documentation site

```sh
npm run docs:dev      # http://localhost:5173/oracular/
npm run docs:build    # same as CI; fails on dead links
npm run docs:preview  # serve the built site
```

`npm run docs:api` runs TypeDoc over `src/index.ts` and writes `docs/api/` (gitignored), so the
API reference is always generated from the JSDoc in `src/`. Guide pages live in `docs/guide/`.
The playground imports the engine from `src/` directly, so it always runs the current code.

## Releasing

The repository is an npm workspace whose root is the `oracular` package itself
(`"workspaces": [".", "packages/*", "examples/react-vite"]`), so Changesets versions and
publishes the root like any other package. `npm run check` at the root stays the single gate;
per-package checks fan out from it with explicit `-w` flags, never `--workspaces` (the root would
recurse into itself).

1. A pull request lands on `main` with a changeset.
2. The release workflow (`.github/workflows/release.yml`) opens or updates a **"chore: version
   packages"** pull request that bumps `package.json` and writes the CHANGELOG entries from the
   pending changesets.
3. Merging that pull request runs the workflow again. With no changesets left, it publishes to
   npm through trusted publishing (OIDC, provenance attached, no tokens), creates the
   `oracular@X.Y.Z` tag and the GitHub release, one of each per package in the workspace
   (releases up to 0.8.0 are tagged `vX.Y.Z`).

Before the Changesets step, a release run in which a workspace package's version is not on npm
yet (that is, a run that is about to publish it) rehearses that publish in the package's directory
with `npm publish --dry-run --json --access public --tag latest`. That runs `prepublishOnly` (the full
`check`) in the real publish environment, including the npm flags that nested npm calls inherit,
and prints its output. If `check` fails there, the job stops with the real error in the log and
nothing is published; the Changesets step would only have reported "command failed". Runs whose
version is already published skip the rehearsal, because npm refuses even a dry run of a
republish. When you change `check` or anything it runs (tests that shell out, the smoke scripts),
rehearse locally with the same command, ideally with the runner's npm major
(`npx npm@12 publish --dry-run ...`).

`main` may be ahead of npm between releases: merged changes wait in the Version Packages PR
until the maintainer merges it. The documentation site deploys from `main` on every push, so it
can describe behaviour that is not yet on npm; the API reference is generated from the same
commit, so the two always agree with each other.

No one runs `npm publish` by hand. If the registry answers 409 for the exact version being
released (a publish still in its staging window), `scripts/release.mjs` verifies the version is
live and treats it as success.
