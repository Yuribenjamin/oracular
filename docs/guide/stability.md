# Stability and the path to 1.0

What you can rely on today, what may still change before 1.0, and what 1.0 will promise. The short version: every state oracular has ever written still loads, every change that could break an integration is announced, and the list of things that must be true before 1.0 is on this page with its status.

## What is public API

- **Every export of `oracular`** and of `oracular/presets`, with the behaviour its documentation describes: the functions, the types, `STATE_VERSION` and `RECORD_VERSION`. The exports test in the repository pins the list; adding to it is an API decision, removing from it follows the deprecation rule below.
- **`oracular/inspect` is experimental.** `inspect` in the main entry is API like any other export; the renderer and the mount helper in the subpath may change their markup, styles and options in a minor without the deprecation rule, until this page says otherwise.
- **The serialized state.** The shape `serialize` writes and `deserialize` reads, versioned by `STATE_VERSION`.
- **The recorder format**, versioned by `RECORD_VERSION`: the lines `createRecord` and `createEndRecord` write, which `oracular replay` and `oracular tune` read.
- **The config JSON Schema** at `oracular/config.schema.json`.
- **Errors.** The three types the library throws, `TypeError`, `RangeError` and `SyntaxError`, which situations throw which, and the `oracular:` prefix on every message. The wording after the prefix may change.
- **The CLI.** The commands, their options, their exit codes, and the shape of the `--json` reports, which may gain fields but not lose or rename them. The text reports are for people and may change at any time.

Not API: anything under `src/` that `index.ts` does not export, the `cli/` modules, the internal order of keys in a serialized state, and the exact floating-point result of a computation beyond what the tests pin.

## Before 1.0

oracular follows semantic versioning, read the way the 0.x convention reads it:

- A **minor** (0.5 to 0.6) may change behaviour in a way an integration has to react to, add features, and change the state format. Every such change is in the changelog with what to do about it.
- A **patch** fixes and never asks anything of you.
- **Deprecation.** An export or option that is going away is marked `@deprecated` in its documentation and named in the changelog for at least one minor before it is removed. The library has no console, so there is no runtime warning; the type checker shows the mark.

## The state format

Three rules hold today and are tested on every release:

1. **Every version ever written loads.** `deserialize` upgrades a state saved by any published release on its own: version 1 (0.1.0 to 0.2.x) and version 2 (0.3.0 to 0.5.x) become version 3. The test suite keeps a state written by each published release, produced from the real tarball, and checks that it loads, that every stored number survives, and that the estimate read after the upgrade is the one read before it.
2. **A migration changes no estimate.** A version bump adds what the new shape needs and leaves α, β, every learned count and every timestamp exactly as they were.
3. **A bump is deliberate.** The version changes only when the shape changes, each bump ships its migration in the same release, and the changelog says so.

The other direction is the rollback hazard: a release that cannot read a newer state throws a `RangeError`, and rolling back a deploy means starting those users from `createState(config)`. Three versions in six minors is more churn than a stored format should see. Two rules address it, one in force from 0.7 and one for 1.0:

4. **A version bump only adds fields.** It never changes the meaning of an existing field or removes one. Both bumps so far were of that kind: version 2 added the occurrence counts of the open episode, version 3 the episodes waiting under `attribution`.
5. **A release reads the next state version.** Because of rule 4, `deserialize` reads a state one version newer than its own as its own, ignoring the fields it does not know. Roll back by one release and every user keeps their history; the next upgrade migrates forward as always. What the rollback loses is whatever the ignored fields held, and an ignored field can hold unsettled state: had 0.5 read a version 3 state this way, the episodes waiting under `attribution` would have been dropped, and their misses never recorded. So every additive bump's changeset must say, in one line, what an older reader silently loses. The cap at one version ahead is a deliberate margin, not a gap in the rule: it covers the rollback a deploy actually makes, and keeps a reader from guessing across two bumps of fields it has never seen. Two versions ahead throws, and `migrate` is still consulted for it.
6. **From 1.0, the state format changes only in a major.** Within a major, states move between any two releases in both directions, which rules 4 and 5 already make true one step at a time.

## What 1.0 means, and what it still needs

1.0 means the API and the state format are commitments under the rules above: a breaking change to either needs a major. It is not a schedule; it is this list being true. Status as of 0.6:

| criterion | status |
| --- | --- |
| The stability policy, written down | this page |
| Property-based tests for purity, monotone decay, the α/β invariant, serialize/deserialize identity, and `shouldReveal ⇒ lower ≥ threshold` | open |
| A framework-free debug overlay showing `predict` and `explain` live | done: [Inspect](/guide/inspect) |
| A public case study produced by `replay` on a production shadow log, and two production users referenced | open; a [reproducible one on a public clickstream](/guide/case-study-clickstream) exists |
| The tolerant state reader: a release reads the next version, so states move both ways one step at a time | done in 0.7 |
| A size ceiling, decided once: the core, meaning the whole `oracular` entry alone, stays under 7 kB minified and gzipped (6.65 kB today; each release's budget is the shipped size plus about 10% and stops at this number). Subpaths have their own rows in the budget file and their own ceilings, 1 kB for `oracular/presets` and 1.5 kB for `oracular/inspect`; adapters live in their own packages | holding |
| Housekeeping green: pinned actions, CodeQL, Scorecard, publish only from CI | holding |

The [roadmap](/guide/roadmap) carries the same list with the reasoning behind each item.

## Reference

- [`STATE_VERSION`](/api/variables/STATE_VERSION), [`RECORD_VERSION`](/api/variables/RECORD_VERSION), [`deserialize`](/api/functions/deserialize), [Persistence & migration](/guide/persistence), [Changelog](/changelog).
