<p align="center">
  <img src="https://raw.githubusercontent.com/Yuribenjamin/oracular/main/assets/logo.svg" width="128" height="128" alt="A tray of cookies">
</p>

<h1 align="center">Your app learns when the user is ready. Nothing leaves the device.</h1>

<p align="center"><em>Named for the Oracle, who knew what you'd choose before you did.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/oracular"><img src="https://img.shields.io/npm/v/oracular" alt="npm version"></a>
  <a href="https://github.com/Yuribenjamin/oracular/actions/workflows/ci.yml"><img src="https://github.com/Yuribenjamin/oracular/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://bundlephobia.com/package/oracular"><img src="https://img.shields.io/bundlephobia/minzip/oracular" alt="bundle size"></a>
  <a href="https://www.npmjs.com/package/oracular"><img src="https://img.shields.io/npm/dm/oracular" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/oracular" alt="MIT license"></a>
  <a href="https://www.bestpractices.dev/projects/15643"><img src="https://www.bestpractices.dev/projects/15643/badge" alt="OpenSSF Best Practices"></a>
</p>

<p align="center">
  <strong>Documentation:</strong> <a href="https://yuribenjamin.github.io/oracular/">yuribenjamin.github.io/oracular</a>
  · <a href="https://yuribenjamin.github.io/oracular/guide/introduction">Guide</a>
  · <a href="https://yuribenjamin.github.io/oracular/api/">API</a>
  · <a href="https://yuribenjamin.github.io/oracular/playground">Playground</a>
</p>

**oracular** is a tiny, zero-dependency, pure-functional intent engine that runs entirely on the device. Feed it the events your app already emits. It keeps a probabilistic estimate of what the user is about to do (upgrade, churn, get stuck, buy…) and tells you when that estimate crosses a threshold *with enough confidence* to act on it: show a tip, make an offer, reveal a feature, place an ad. It learns from each user's own outcomes, so your initial guesses get corrected on their device, not on a server.

It never touches the network, storage, DOM, timers or globals. Your app owns persistence and side effects; the library owns the math.

## Why oracular

|                              | oracular                                              | Hosted analytics SDKs                        | Rule engines                              |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| **Where scoring runs**       | On the device, inside your app                        | On the vendor's servers                      | In your code, rule by rule                |
| **Data leaving the device**  | None; the library has no I/O                          | Events are sent to the vendor                | None, unless you add it                   |
| **Learns per user**          | Yes, from each user's own outcomes, on their device   | Typically across users, server-side          | No; rules are static until you edit them  |
| **Explainable**              | Per-signal contribution and impact for every answer   | Varies; model internals are usually hidden   | Yes, but only as far as the rules go      |
| **Dependencies**             | Zero                                                  | An SDK plus a network stack                  | Depends on the engine                     |
| **Works offline**            | Always                                                | Degrades or queues until online              | Yes                                       |

oracular sits between the other two: more adaptive than fixed rules, and private where hosted scoring is not. If you need population-level analytics or experiments, use a tool built for that; if you need to know when *this* user is ready, without telling anyone, this is the one.

Install with `npm install oracular`, then:

```ts
import { createState, markRevealed, observe, shouldReveal } from 'oracular';
let state = createState({
  episodeTimeout: 30 * 60 * 1000, // 30 idle minutes end a session
  intents: {
    upgrade: {
      prior: 0.05, priorStrength: 10, halfLife: 7 * 24 * 60 * 60 * 1000, // one week, in ms
      signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
      outcome: 'upgrade.completed',
    },
  },
});
state = observe(state, { name: 'pricing.viewed', at: Date.now() });
if (shouldReveal(state, 'upgrade', Date.now())) {
  state = markRevealed(state, 'upgrade', Date.now()); // ...then show your offer
}
```

With these numbers the offer fires after roughly six strong signals across separate sessions inside a week (p must clear 0.5 with a 90% lower bound); repeats within one session count for less. Lower `priorStrength` or raise the weights to fire sooner.

That block is copied verbatim into the test suite, so it always runs.

## Contents

- [Why oracular](#why-oracular)
- [How it works](#how-it-works)
- [Examples](#examples)
- [Using with React](#using-with-react)
- [API](#api)
- [Persistence](#persistence)
- [Explainability](#explainability)
- [Design rules](#design-rules)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

The [documentation site](https://yuribenjamin.github.io/oracular/) has the long form: one page per concept, a tuning guide with tables, recipes, framework examples, the generated API reference and a playground that runs the engine in your browser.

## How it works

### Intents are Beta distributions

You declare intents. Each has a `prior` probability and a `priorStrength` (how many observations the prior is worth). Internally an intent is a Beta(α, β) distribution with α₀ = prior × priorStrength and β₀ = (1 − prior) × priorStrength. Its current estimate is p = α / (α + β).

### Signals add evidence

Each intent maps event names to weights. A positive weight is evidence *for* the intent and is added to α; a negative weight is evidence *against* and its magnitude is added to β. Events the config doesn't mention cost nothing.

### Repeats within a session count for less

Ten views of the pricing page in one sitting are one burst of interest, not ten independent pieces of evidence. Within an episode, the n-th occurrence of a signal adds less than the first:

```
n-th occurrence adds   w × log2(1 + 1/n)     1, 0.58, 0.42, 0.32 … of the weight
n occurrences add      w × log2(1 + n)       every doubling adds one more weight; ten add 3.46, not 10
```

The count restarts when the episode ends or the intent's outcome arrives, so the same signal in a new session counts fully again. Saturation is on by default when `episodeTimeout` is set. Without it, episodes end only when you call `endEpisode`, so repeats add their full weight unless you set `saturate: true`. For intents where the repetition itself is the evidence (a user stuck on the same step), set `saturate: false` and every occurrence adds its full weight.

### Evidence decays toward the prior

Before any update or reading, the evidence decays by 2^(−Δt / halfLife), where Δt is the time since the intent was last updated. Only the *excess over the prior* decays: with no events, p drifts back to `prior` and α + β back to `priorStrength`. Someone who looked at pricing a month ago is not someone who looked at pricing today.

### The user's history corrects your weights

Events happen inside **episodes** (sessions). An episode ends when you call `endEpisode`, or on its own after `episodeTimeout` of inactivity. Signals seen in the episode are remembered per intent. When the intent's `outcome` event arrives, each remembered signal gets a **hit**; when the episode ends without it, each gets a **miss**. The engine also counts, per intent, how many episodes ended with and without the outcome: the intent's **base rate**.

A signal's weight is then a blend of your prior and the learned estimate:

```
nWith    = hits + misses                                      episodes with the signal
nWithout = episodes − nWith                                   episodes without it
qWith    = (hits + 1) / (nWith + 2)                           outcome rate with the signal
qWithout = (outcomes − hits + 1) / (nWithout + 2)             outcome rate without it
lift     = (qWith − qWithout) / (1 − qWithout)  if qWith ≥ qWithout,  else  (qWith − qWithout) / qWithout   → in [−1, 1]
learned  = gain × |w₀| × lift                                 0 until the signal has history
nEff     = (nWith × nWithout) / (nWith + nWithout)            0 if either side is 0
effective = (k × w₀ + nEff × learned) / (k + nEff)            k = priorEpisodes
```

`w₀` is your initial weight, `gain` (default 2) caps how far a perfectly predictive signal can grow, and `priorEpisodes` (default 10) is how much contrast it takes for the user's own history to count as much as your guess. A signal's strength and your confidence in it are separate knobs. A signal is judged against the sessions in which it did *not* appear, so for an outcome that happens in 3% of sessions, a signal followed by it 30% of the time is strong evidence, not weak. And learning needs contrast: a signal that has never been absent has no counterfactual, so its weight stands until there are sessions without it. Nothing drifts after a single outcome.

Learned counts never decay unless you set `learning.halfLife`.

### Reveal only when confident

`shouldReveal` is true when p ≥ threshold **and** p − z·sd ≥ threshold, where sd is the Beta standard deviation and z defaults to 1.28 (a one-sided 90% bound). Thin evidence with a high mean does not fire; it takes a few consistent signals. After you `markRevealed`, the intent stays revealed for a `cooldown` (default: its half-life) so you don't fire on every event. The same cooldown runs after the intent's outcome event. `predict` reports both: `revealed` is true inside a reveal cooldown, and `suppressedUntil` is when the later of the two cooldowns ends, or null when `shouldReveal` is free to fire.

### Outcomes reset the slate and pause reveals

When the outcome event arrives, the intent's evidence returns to the prior (α, β and contributions), while everything learned is kept. The user already upgraded; stop predicting that they will. Set `resetOnOutcome: false` for intents where the outcome can repeat inside one episode.

The outcome also starts the intent's `cooldown`: `shouldReveal` stays false until it ends, however strong the fresh evidence, so a user who just bought is not immediately pitched again. The time of the last outcome is kept on the state as `lastOutcomeAt`.

### Every answer comes with its reasons

`explain` returns, per signal, how much evidence it currently holds and how much p would move without it, plus the initial, learned and effective weights and the hit/miss record. If a reveal looks wrong, you can see exactly why it fired.

## Examples

The ad case is one of these, not the point of the library.

### Onboarding tip when the user is stuck

```ts
const config = {
  episodeTimeout: 30 * 60 * 1000,
  intents: {
    stuck: {
      prior: 0.1,
      priorStrength: 5,
      halfLife: 10 * 60 * 1000, // ten minutes: being stuck is a short-lived state
      signals: { 'editor.undo': 1, 'search.empty': 2, 'help.opened': 3, 'task.completed': -4 },
      outcome: 'help.article.read',
      saturate: false, // the fifth undo in a row is more evidence, not less
      reveal: { threshold: 0.6, cooldown: 60 * 60 * 1000 },
    },
  },
};
```

### Upgrade offer

The quickstart above. Signals that are followed by `upgrade.completed` grow heavier for this user; the ones that aren't shrink, even to negative.

### Churn save

```ts
const churn = {
  prior: 0.08,
  priorStrength: 20,
  halfLife: 14 * 24 * 60 * 60 * 1000,
  signals: {
    'session.short': 1,
    'notifications.disabled': 3,
    'export.all': 4, // taking their data with them
    'feature.new.used': -2,
  },
  outcome: 'account.cancelled',
  reveal: { threshold: 0.5, z: 1.64 }, // be surer before you offer a discount
};
```

### Ad placement

```ts
const willBuy = {
  prior: 0.02,
  priorStrength: 50,
  halfLife: 3 * 24 * 60 * 60 * 1000,
  signals: { 'product.viewed': 1, 'cart.added': 3, 'wishlist.added': 2, 'cart.emptied': -3 },
  outcome: 'checkout.completed',
};
// shouldReveal(state, 'willBuy', now) → show the sponsored placement, then markRevealed.
```

More in the docs: [Recipes](https://yuribenjamin.github.io/oracular/guide/recipes) and the [Tuning guide](https://yuribenjamin.github.io/oracular/guide/tuning).

## Using with React

oracular ships no framework code; this is the userland shape. Load with your current config, observe, persist on change:

```tsx
import { useEffect, useState } from 'react';
import { createState, deserialize, markRevealed, observe, serialize, shouldReveal } from 'oracular';
import { config } from './intent-config';

function load() {
  const saved = localStorage.getItem('oracular');
  return saved ? deserialize(saved, { config }) : createState(config); // always pass the config you ship now
}

export function useIntent() {
  const [state, setState] = useState(load);
  useEffect(() => localStorage.setItem('oracular', serialize(state)), [state]);

  const track = (name: string) => setState((s) => observe(s, { name, at: Date.now() }));
  const reveal = (intent: string) => {
    const now = Date.now();
    if (!shouldReveal(state, intent, now)) return false;
    setState((s) => markRevealed(s, intent, now));
    return true;
  };
  return { track, reveal };
}
```

Add `endEpisode` on `pagehide` and you have the whole lifecycle. The same loop for Vue, React Native and Node is on the [frameworks page](https://yuribenjamin.github.io/oracular/guide/frameworks).

## API

Every function is pure: it never mutates its input and returns the same output for the same input. State is a plain, JSON-serializable object.

```ts
createState(config: EngineConfig): EngineState
observe(state, event: { name: string; at: number; props?: Record<string, unknown> }): EngineState
endEpisode(state, at: number): EngineState
predict(state, intent: string, at: number, opts?: RevealOptions): Prediction
shouldReveal(state, intent: string, at: number, opts?: RevealOptions): boolean
markRevealed(state, intent: string, at: number): EngineState
explain(state, intent: string, at: number, opts?: { nonZero?: boolean; limit?: number }): SignalExplanation[]
evaluate(state, intent: string, at: number, opts?): { prediction, reveal, explanation }  // all three, one decay pass
evidenceToReveal(intentConfig, opts?): number   // pseudo-counts at which shouldReveal first becomes true
episodeClosed(prev, next): boolean               // did an episode close between two states?
createRecord(state, event, { installId, mode }): EventRecord   // one recorder line: the event and what was decided
createEndRecord(at, { installId, mode }): EndRecord           // one recorder line: the episode ended
serialize(state): string
deserialize(json: string, opts?: { config?: EngineConfig; migrate?: Migrate }): EngineState
STATE_VERSION // 2
RECORD_VERSION // 1
```

### Config

```ts
interface EngineConfig {
  intents: Record<string, IntentConfig>;
  episodeTimeout?: number;   // idle gap that ends an episode; off if omitted
  learning?: {
    halfLife?: number;       // forgetting of learned counts; off if omitted
    gain?: number;           // learned weight cap = gain × |initial|; default 2, at most 1e6
    priorEpisodes?: number;  // pseudo-count behind your weights; default 10, at most 1e6
  };
  reveal?: RevealOptions;    // defaults for every intent
}

interface IntentConfig {
  prior: number;                    // (0, 1)
  priorStrength: number;            // > 0, at most 1e6
  halfLife: number;                 // > 0
  signals: Record<string, number>;  // event name → weight, non-zero, between −1e6 and 1e6
  outcome?: string;                 // event that confirms the intent
  resetOnOutcome?: boolean;         // default true
  saturate?: boolean;               // repeats within an episode add less; default: episodeTimeout is set
  reveal?: RevealOptions;
}

interface RevealOptions {
  threshold?: number;  // default 0.5
  z?: number;          // default 1.28
  cooldown?: number;   // default: the intent's halfLife
}
```

Reveal options resolve per call → intent → engine → defaults. Invalid config throws a `TypeError` or `RangeError` with the offending path in the message.

### Results

```ts
interface Prediction {
  intent: string;
  p: number;            // α / (α + β)
  sd: number;           // Beta standard deviation
  lower: number;        // p − z·sd, clamped to [0, 1]; what shouldReveal compares to threshold
  confidence: number;   // 1 − 2·sd, clamped to [0, 1]. A heuristic: 1 is a sharp estimate, 0 is as vague as a Beta gets
  evidence: number;     // α + β, prior strength included
  revealed: boolean;    // inside the cooldown after markRevealed
  revealedAt: number | null;
  suppressedUntil: number | null; // end of the later running cooldown (reveal or outcome); null when none is running
}

interface SignalExplanation {
  signal: string;
  contribution: number;    // signed pseudo-counts currently held, after decay
  impact: number;          // p − p without this signal
  initialWeight: number;
  learnedWeight: number;
  effectiveWeight: number; // what the signal's first occurrence in an episode adds
  hits: number;
  misses: number;
}
```

### Time

`at` is a timestamp. Every duration (`halfLife`, `cooldown`, `episodeTimeout`, `learning.halfLife`) is in the same unit as `at`. Milliseconds from `Date.now()` are the obvious choice, but the library never calls `Date.now()` itself: you pass time in, which keeps every function deterministic and makes tests trivial. A clock that jumps backwards is tolerated (no decay, no error).

## Persistence

The state is plain JSON. Save it however you like:

```ts
localStorage.setItem('oracular', serialize(state));
```

`createState` persists a snapshot of the config inside the state, so a saved state remembers the weights it was built with. On load, pass the config your app ships *now*:

```ts
const state = deserialize(saved, { config });
```

The new config is validated and swapped in. Intents and signals you no longer declare are dropped (α and β are recomputed from what remains), newly declared intents start at their prior, and everything learned about signals that still exist is kept.

States saved by an older version of this library are upgraded on load: `deserialize` migrates the state shape written by oracular 0.1.0 to 0.2.x (`STATE_VERSION` 1) to the current one on its own. A `migrate` function is consulted only for a version the library does not know, such as a state written by a newer oracular before a rollback; without one, that throws a `RangeError`:

```ts
deserialize(saved, {
  config,
  migrate: (stored, version) => upgradeFromV(version, stored),
});
```

Event `props` are accepted for forward compatibility and are never stored.

## Explainability

After ten sessions in which `pricing.viewed` led to an upgrade six times out of seven and `export.clicked` appeared every time, whether or not the user upgraded:

```ts
explain(state, 'upgrade', Date.now());
// [
//   { signal: 'pricing.viewed', contribution: 3.12, impact: 0.16, initialWeight: 3, learnedWeight: 3.78, effectiveWeight: 3.13, hits: 6, misses: 1 },
//   { signal: 'limit.hit',      contribution: 2,    impact: 0.10, initialWeight: 2, learnedWeight: 0,    effectiveWeight: 2,    hits: 0, misses: 0 },
//   { signal: 'export.clicked', contribution: 0,    impact: 0,    initialWeight: 1, learnedWeight: 0.67, effectiveWeight: 1,    hits: 7, misses: 3 },
// ]
```

Rows are sorted by the size of their impact. `limit.hit` has no history yet, so its effective weight is exactly the initial one. `pricing.viewed` was followed by an upgrade in six of its seven sessions while the three sessions without it saw one upgrade, so it learned a weight above the initial 3. `export.clicked` appeared in every session: it has no counterfactual, so whatever its hit rate, its weight stands at exactly the initial 1 until a session happens without it. See [Episodes & learning](https://yuribenjamin.github.io/oracular/guide/concepts/episodes-and-learning) for why learning needs contrast.

## Design rules

- **Pure.** Inputs are never mutated; the same input always gives the same output. Internally, α and β are always the prior plus the sum of per-signal contributions, so `explain` adds up.
- **Portable.** No DOM, Node or React Native specific APIs; the source compiles against the ES2020 library alone. ESM and CommonJS builds with type declarations.
- **Private.** Nothing leaves the device because nothing *can*: there is no I/O in the library.
- **Honest about uncertainty.** `shouldReveal` needs both a high mean and a high lower bound.

## Roadmap

Next is 0.3, themed **proof**: a recorder format for shadow mode, `npx oracular replay` to measure a config offline, per-episode saturation, and state robustness tests. Then cross-episode attribution and `tune` in 0.4, and a written stability policy before 1.0. Framework bindings wait for a third integration. The full list, with the reasoning and what was declined, is on the [roadmap page](https://yuribenjamin.github.io/oracular/guide/roadmap).

## Contributing

Bug reports, model discussions and pull requests are welcome. Start with the [contributing guide](./CONTRIBUTING.md) for the development setup, the test rules (every state-returning operation is followed by `assertInvariants`), and the release process. The project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md); security issues go through the [security policy](./SECURITY.md), privately.

## License

[MIT](./LICENSE) © Ibrahim Ragab
