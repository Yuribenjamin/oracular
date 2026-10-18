# Persistence & migration

The state is plain JSON. oracular never stores anything itself; your app does, wherever it likes.

## Save

```ts
import { serialize } from 'oracular';

localStorage.setItem('oracular', serialize(state));
```

[`serialize`](/api/functions/serialize) is `JSON.stringify` after a shape check. The output contains your config snapshot, α and β per intent, per-signal contributions and hit/miss counts, the open episode, and the reveal and outcome timestamps. It never contains event `props`. For a handful of intents it is a few kilobytes.

Persist after every `observe` if writes are cheap (localStorage, an in-memory store flushed later), or debounce; always persist after `endEpisode`, and persist at once whenever [`episodeClosed(prev, next)`](/api/functions/episodeClosed) is true, since a close is where misses are recorded. On mobile, flush the pending save when the app goes to the background; see [Using with frameworks](/guide/frameworks#react-native).

## Load: pass your current config

```ts
import { createState, deserialize } from 'oracular';

const saved = localStorage.getItem('oracular');
let state = saved ? deserialize(saved, { config }) : createState(config);
```

`createState` stores a snapshot of the config inside the state, so a saved state remembers the weights it was built with. **That snapshot is for migrations, not for running.** When you ship a new version with different weights, a new signal or a removed intent, the saved state must follow your code, so pass the config your app ships *now* to [`deserialize`](/api/functions/deserialize). It then:

- validates the new config exactly as `createState` would,
- replaces the stored snapshot,
- drops intents you no longer declare, together with their episode records,
- starts newly declared intents at their prior,
- drops contributions, learned counts and episode `seen` entries for signals an intent no longer declares,
- recomputes α and β as the (possibly new) prior plus the kept contributions, so a changed `prior` or `priorStrength` applies immediately while the evidence stays.

Everything learned about signals that still exist is kept. Loading **without** `config` restores the old snapshot and silently runs your old weights; it is the one mistake these docs most want you to avoid.

## Migrating the state shape

The stored state carries [`STATE_VERSION`](/api/variables/STATE_VERSION). A release that changes the shape of the state ships the migration with it, and `deserialize` applies it on its own: oracular 0.3 reads states saved by 0.1.0 to 0.2.x (version 1) and upgrades them to version 2, in which the open episode also counts how often each signal occurred (each signal seen before the upgrade counts once). Every estimate is exactly what it was before the upgrade. The test suite keeps a state saved by every published version and checks that each one loads and migrates.

`migrate` is only for a version the library does not know, such as a state written by a newer oracular and read after a rollback. It receives the parsed JSON and its version and returns a current state; without it, such a state throws a `RangeError`.

**Rolling back.** oracular 0.2.x cannot read a version 2 state; it throws a `RangeError`. If you might roll back, or simply want a launch never to fail on stored data, catch and start fresh:

```ts
let state: EngineState;
try {
  state = saved ? deserialize(saved, { config }) : createState(config);
} catch {
  state = createState(config); // unreadable, tampered, or from a newer oracular
}
```

## Validation and errors

`deserialize` validates everything: the config, every number (finite, in range), every key (undeclared signals and intents are pruned, prototype-polluting keys are ignored), the episode. It never returns a state that violates the engine's invariants; it throws instead:

| Error         | When                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `SyntaxError` | the string is not valid JSON                                                                           |
| `RangeError`  | the stored `version` differs from `STATE_VERSION` and no `migrate` was given; `migrate` did not return the current version; a stored number is out of range (a negative count, a fractional `revealCount`) |
| `TypeError`   | the state is malformed: no numeric `version`, a missing or wrongly typed field, an invalid `config`, invalid options |

The same three types are used everywhere in the library (`createState`, `observe`, the options of `predict`, `explain` and `evaluate`), with the offending path in the message. If you store state where users can edit it, catch and fall back to `createState(config)`.

## One state per user

Learning is per user. Give each account its own state and never share one across users or devices unless you want them to learn from each other. A signed-out visitor can have an anonymous state that you drop or merge on sign-in, as you see fit; the engine has no opinion.

## Reference

- [`serialize`](/api/functions/serialize), [`deserialize`](/api/functions/deserialize), [`DeserializeOptions`](/api/interfaces/DeserializeOptions), [`Migrate`](/api/type-aliases/Migrate), [`EngineState`](/api/interfaces/EngineState).
