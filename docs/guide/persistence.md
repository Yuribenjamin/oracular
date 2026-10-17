# Persistence & migration

The state is plain JSON. oracular never stores anything itself; your app does, wherever it likes.

## Save

```ts
import { serialize } from 'oracular';

localStorage.setItem('oracular', serialize(state));
```

[`serialize`](/api/functions/serialize) is `JSON.stringify` after a shape check. The output contains your config snapshot, α and β per intent, per-signal contributions and hit/miss counts, the open episode, and the reveal and outcome timestamps. It never contains event `props`. For a handful of intents it is a few kilobytes.

Persist after every `observe` if writes are cheap (localStorage, an in-memory store flushed later), or debounce; and always persist after `endEpisode`.

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

The stored state carries [`STATE_VERSION`](/api/variables/STATE_VERSION). When a future release of oracular changes the shape of the state, `deserialize` refuses a stored state of a different version unless you pass a `migrate` function, which receives the parsed JSON and its version and returns a current state:

```ts
const state = deserialize(saved, {
  config,
  migrate: (stored, version) => {
    if (version === 1) return upgradeFromV1(stored); // provided with the release that bumps the version
    throw new Error(`unknown oracular state version ${version}`);
  },
});
```

The release notes for any version bump will include the migration. Until then, `migrate` is never called.

## Validation

`deserialize` validates everything: the config, every number (finite, in range), every key (undeclared signals and intents are pruned, prototype-polluting keys are ignored), the episode. A tampered or truncated string throws a `TypeError`, `RangeError` or `SyntaxError` rather than producing a state that violates the engine's invariants. If you store state where users can edit it, catch and fall back to `createState(config)`.

## One state per user

Learning is per user. Give each account its own state and never share one across users or devices unless you want them to learn from each other. A signed-out visitor can have an anonymous state that you drop or merge on sign-in, as you see fit; the engine has no opinion.

## Reference

- [`serialize`](/api/functions/serialize), [`deserialize`](/api/functions/deserialize), [`DeserializeOptions`](/api/interfaces/DeserializeOptions), [`Migrate`](/api/type-aliases/Migrate), [`EngineState`](/api/interfaces/EngineState).
