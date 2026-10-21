# Stability and the path to 1.0

What you can rely on today, what may still change before 1.0, and what 1.0 will promise. The short version: every state oracular has ever written still loads, every change that could break an integration is announced, and the list of things that must be true before 1.0 is on this page with its status.

## What is public API

- **Every export of `oracular`** and of `oracular/presets`, with the behaviour its documentation describes: the functions, the types, `STATE_VERSION` and `RECORD_VERSION`. The exports test in the repository pins the list; adding to it is an API decision, removing from it follows the deprecation rule below. The `DeepReadonly` helper type that `oracular/presets` exports beside the presets is a utility, not a commitment.
- **`@oracular/react`** is a separate package with its own 0.x version and changelog. Its exports are API under the same rules, with `oracular` as a peer dependency; its size budget lives in its own budget file (2 kB for the hook and the localStorage adapter, 2.7 kB for the whole package).
- **`oracular/inspect` is experimental.** `inspect` in the main entry is API like any other export; the renderer and the mount helper in the subpath may change their markup, styles and options in a minor without the deprecation rule, until this page says otherwise.
- **The serialized state.** The shape `serialize` writes and `deserialize` reads, versioned by `STATE_VERSION`.
- **The recorder format**, versioned by `RECORD_VERSION`: the lines `createRecord` and `createEndRecord` write, which `oracular replay` and `oracular tune` read.
- **The config JSON Schema** at `oracular/config.schema.json`.
- **Errors.** The three types the library throws, `TypeError`, `RangeError` and `SyntaxError`, which situations throw which, and the `oracular:` prefix on every message. The wording after the prefix may change.
- **The CLI.** The commands, their options, their exit codes, and the shape of the `--json` reports, which may gain fields but not lose or rename them: a field another supersedes (`windowIsCooldown`, superseded by `windowSource` in 0.10) stays, marked deprecated in its documentation. The text reports are for people and may change at any time.

Not API: anything under `src/` that `index.ts` does not export, the `cli/` modules, the internal order of keys in a serialized state, and the exact floating-point result of a computation beyond what the tests pin.

## Before 1.0

oracular follows semantic versioning, read the way the 0.x convention reads it:

- A **minor** (0.5 to 0.6) may change behaviour in a way an integration has to react to, add features, and change the state format. Every such change is in the changelog with what to do about it.
- A **patch** fixes and never asks anything of you.
- **Deprecation.** An export or option that is going away is marked `@deprecated` in its documentation and named in the changelog for at least one minor before it is removed. The library has no console, so there is no runtime warning; the type checker shows the mark.

## From 1.0

Within a major, nothing that was public is taken away or changed in meaning: an export, option, field, report field or CLI flag that is going away is marked `@deprecated` in its declaration and named in the changelog of the minor that deprecates it, keeps working unchanged for the rest of the major, and is removed only in the next major. A deprecated option keeps its behaviour when set. There is no runtime warning. The state and recorder formats gain fields in a minor and change the meaning of a field only in a major, and every additive bump's changeset says what an older reader loses. A config key added in a minor is ignored by an older reader of a stored state whenever the app passes its current config. A minor may add; a patch fixes and never asks anything of you.

## The state format

Three rules hold today and are tested on every release:

1. **Every version ever written loads.** `deserialize` upgrades a state saved by any published release on its own: version 1 (0.1.0 to 0.2.x), version 2 (0.3.0 to 0.5.x) and version 3 (0.6.0 to 0.11.x) become version 4. The test suite keeps a state written by each published release, produced from the real tarball, and checks that it loads, that every stored number survives, and that the estimate read after the upgrade is the one read before it.
2. **A migration changes no estimate.** A version bump adds what the new shape needs and leaves α, β, every learned count and every timestamp exactly as they were.
3. **A bump is deliberate.** The version changes only when the shape changes, each bump ships its migration in the same release, and the changelog says so.

The other direction is the rollback hazard: a release that cannot read a newer state throws a `RangeError`, and rolling back a deploy means starting those users from `createState(config)`. Four versions in twelve minors is more churn than a stored format should see. Two rules address it, one in force from 0.7 and one for 1.0:

4. **A version bump only adds fields.** It never changes the meaning of an existing field or removes one. All three bumps so far were of that kind: version 2 added the occurrence counts of the open episode, version 3 the episodes waiting under `attribution`, version 4 the engine's clock.
5. **A release reads the next state version.** Because of rule 4, `deserialize` reads a state one version newer than its own as its own, ignoring the fields it does not know. Roll back by one release and every user keeps their history; the next upgrade migrates forward as always. What the rollback loses is whatever the ignored fields held, and an ignored field can hold unsettled state: had 0.5 read a version 3 state this way, the episodes waiting under `attribution` would have been dropped, and their misses never recorded. So every additive bump's changeset must say, in one line, what an older reader silently loses. The cap at one version ahead is a deliberate margin, not a gap in the rule: it covers the rollback a deploy actually makes, and keeps a reader from guessing across two bumps of fields it has never seen. Two versions ahead throws, and `migrate` is still consulted for it. The config snapshot inside the state is covered too, from 0.13: when the app passes its current config to `deserialize`, the snapshot is not read, so a config key or value that a newer release wrote is no obstacle either. Before 0.13 it threw a `TypeError`, which is why the 0.8 and 0.9 changelogs asked for `bound` or `learning.lift` to be removed from a saved config before rolling back.
6. **From 1.0, the state format changes only in a major.** Within a major, states move between any two releases in both directions, which rules 4 and 5 already make true one step at a time, for the state's fields and for the config snapshot alike.

## What 1.0 means, and what it still needs

1.0 means the API and the state format are commitments under the rules above: a breaking change to either needs a major. It is not a schedule; it is this list being true. Status as of 0.17:

| criterion | status |
| --- | --- |
| The stability policy, written down | this page |
| Property-based tests for purity, monotone decay, the α/β invariant, serialize/deserialize identity, and `shouldReveal ⇒ lower ≥ threshold` | done: [tests/property.test.ts](https://github.com/Yuribenjamin/oracular/blob/main/tests/property.test.ts) |
| A framework-free debug overlay showing `predict` and `explain` live | done: [Inspect](/guide/inspect) |
| A public case study produced by `replay` on a production shadow log, and two production users referenced | open; a [reproducible one on a public clickstream](/guide/case-study-clickstream) exists |
| The tolerant state reader: a release reads the next version, so states move both ways one step at a time | done in 0.7 |
| A size ceiling for the core, meaning the whole `oracular` entry alone: under 9 kB minified and gzipped (8.2 kB today). Each release's budget is the shipped size plus about 10% and stops at this number, and from 1.0 the number is not raised within a major: a feature that does not fit waits for 2.0. The ceiling was 7 kB until 0.8, when the exact lower bound added 0.54 kB, and 7.9 kB until 0.12, when the clock rule and its state version added 0.37 kB; both times it was raised to the shipped size plus about 10%, each raise a line in the changelog, and 0.17 set the 1.0 number. Subpaths have their own rows in the budget file and their own ceilings, 1 kB for `oracular/presets` and 1.2 kB for `oracular/inspect`; adapters live in their own packages | holding |
| Housekeeping green: pinned actions, CodeQL, Scorecard, publish only from CI | holding |

The [roadmap](/guide/roadmap) carries the same list with the reasoning behind each item.

## Reference

- [`STATE_VERSION`](/api/variables/STATE_VERSION), [`RECORD_VERSION`](/api/variables/RECORD_VERSION), [`deserialize`](/api/functions/deserialize), [Persistence & migration](/guide/persistence), [Changelog](/changelog).
