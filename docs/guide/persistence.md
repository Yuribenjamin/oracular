# Persistence & migration

The state is plain JSON. oracular never stores anything itself; your app does, wherever it likes.

## Save

```ts
import { serialize } from 'oracular';

localStorage.setItem('oracular', serialize(state));
```

[`serialize`](/api/functions/serialize) is `JSON.stringify` after a shape check. The output contains your config snapshot, α and β per intent, per-signal contributions and hit/miss counts, the episodes waiting under `attribution`, the open episode, and the reveal and outcome timestamps. It never contains event `props`. For a handful of intents it is a few kilobytes. Loading a state and saving it again produces the same string, so a save can be skipped when the string has not changed.

Persist after every `observe` if writes are cheap (localStorage, an in-memory store flushed later), or debounce; always persist after `endEpisode`, and persist at once whenever [`episodeClosed(prev, next)`](/api/functions/episodeClosed) is true, since a close is where misses are recorded. On mobile, flush the pending save when the app goes to the background; see [Using with frameworks](/guide/frameworks#react-native).

## Load: pass your current config

```ts
import { createState, deserialize } from 'oracular';

const saved = localStorage.getItem('oracular');
let state = saved ? deserialize(saved, { config }) : createState(config);
```

`createState` stores a snapshot of the config inside the state, so a saved state remembers the weights it was built with. **That snapshot is for migrations, not for running.** When you ship a new version with different weights, a new signal or a removed intent, the saved state must follow your code, so pass the config your app ships *now* to [`deserialize`](/api/functions/deserialize). It then:

- validates the new config exactly as `createState` would,
- replaces the stored snapshot (which is read without the checks that refuse a config that cannot work, so a state saved by an older release with, say, a reveal `threshold` of 0 still loads; without a config passed in, the state runs with that stored config as it is),
- drops intents you no longer declare, together with their episode records,
- starts newly declared intents at their prior,
- drops contributions, learned counts and episode `seen` entries for signals an intent no longer declares,
- recomputes α and β as the (possibly new) prior plus the kept contributions, so a changed `prior` or `priorStrength` applies immediately while the evidence stays.

Everything learned about signals that still exist is kept. Loading **without** `config` restores the old snapshot and silently runs your old weights; it is the one mistake these docs most want you to avoid.

::: tip In `@oracular/react`
The store does this for you, with the rules a hand-written loop tends to get wrong: nothing is written before the stored state has been read, a flush during the read waits for it, events tracked meanwhile are replayed onto the loaded state, and a read that fails blocks writes until a later one succeeds. See [Using with frameworks](/guide/frameworks#react).
:::

## Migrating the state shape

The stored state carries [`STATE_VERSION`](/api/variables/STATE_VERSION). A release that changes the shape of the state ships the migration with it, and `deserialize` applies it on its own. Version 1 (0.1.0 to 0.2.x) became version 2 in 0.3.0, when the open episode started counting how often each signal occurred (each signal seen before the upgrade counts once); version 2 (0.3.0 to 0.5.x) became version 3 in 0.6.0, which adds the list of episodes waiting under `attribution` (empty for an upgraded state); version 3 (0.6.0 to 0.11.x) becomes version 4 in 0.12.0, which adds the engine's clock (for an upgraded state, the latest time its anchors were written at, with no stamp held). Every estimate is exactly what it was before the upgrade. The test suite keeps a state saved by every published version and checks that each one loads and migrates.

`migrate` is only for a version the library does not know, such as a state written by a newer oracular and read after a rollback. It receives the parsed JSON and its version and returns a current state; without it, such a state throws a `RangeError`. What may still change in the state format before 1.0, and what 1.0 promises about it, is on [Stability and 1.0](/guide/stability).

**Rolling back.** From 0.7, a release reads a state one version newer than its own as its own, ignoring the fields that version added: roll back by one release and every user keeps their history. What is lost is whatever the ignored fields held; the changelog entry of every version bump says what that is for that bump, because an ignored field can hold state that then never settles. A version bump only ever adds fields, which is what makes the rest safe ([Stability and 1.0](/guide/stability#the-state-format)). Two versions ahead, or any release before 0.7 reading a newer state, throws a `RangeError`. If you might roll back further, or simply want a launch never to fail on stored data, catch and start fresh:

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
| `RangeError`  | the stored `version` is one this library does not know and no `migrate` was given; `migrate` did not return the current version; a stored number is out of range (a negative count, a fractional `revealCount`, a config weight beyond ±1e6); stored numbers that are each finite but too large to compute with, which would make the estimates NaN |
| `TypeError`   | the state is malformed: no numeric `version`, a missing or wrongly typed field, an invalid `config`, invalid options |

The same three types are used everywhere in the library (`createState`, `observe`, the options of `predict`, `explain` and `evaluate`), with the offending path in the message. A fuzz test feeds `deserialize` truncated, corrupted and tampered versions of stored states and checks that it only ever throws one of these three or returns a state whose estimates stay finite. The checks refuse what cannot work (a `prior` or `threshold` of 0 or 1, a `z` past 10, a weight of 0, an outcome that is also a signal under the reset) and accept everything that can be meant: a `halfLife` is any positive finite number, however short or long, a `threshold` of 1e-12 is a threshold, and any non-empty name except `__proto__` is a name, `constructor` included, since every lookup is an own-property check. If you store state where users can edit it, catch and fall back to `createState(config)`; the `@oracular/react` store reports such a state as `onError(error, 'parse')`, keeps working in memory without overwriting it or reading it again, and starts fresh on `store.clear()`. To run the config checks on their own, without a state, call [`validateConfig`](/api/functions/validateConfig).

## One state per user

Learning is per user. Give each account its own state and never share one across users or devices unless you want them to learn from each other. A signed-out visitor can have an anonymous state that you drop or merge on sign-in, as you see fit; the engine has no opinion. With `@oracular/react`, `store.clear()` drops the stored state and starts fresh, and `await store.dispose()` stops a store's writes before you wipe its storage yourself.

## Reference

- [`serialize`](/api/functions/serialize), [`deserialize`](/api/functions/deserialize), [`DeserializeOptions`](/api/interfaces/DeserializeOptions), [`Migrate`](/api/type-aliases/Migrate), [`EngineState`](/api/interfaces/EngineState).
