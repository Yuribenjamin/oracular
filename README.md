<p align="center">
  <img src="https://raw.githubusercontent.com/Yuribenjamin/oracular/main/assets/logo.svg" width="128" height="128" alt="A tray of cookies">
</p>

<h1 align="center">Your app learns when the user is ready. Nothing leaves the device.</h1>

<p align="center"><em>Named for the Oracle, who knew what you'd choose before you did.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/oracular"><img src="https://img.shields.io/npm/v/oracular" alt="npm version"></a>
  <a href="https://github.com/Yuribenjamin/oracular/actions/workflows/ci.yml"><img src="https://github.com/Yuribenjamin/oracular/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/oracular" alt="MIT license"></a>
</p>

**oracular** is a tiny, zero-dependency, pure-functional intent engine that runs entirely on the device. Feed it the events your app already emits. It keeps a probabilistic estimate of what the user is about to do (upgrade, churn, get stuck, buy…) and tells you when that estimate crosses a threshold *with enough confidence* to act on it: show a tip, make an offer, reveal a feature, place an ad. It learns from each user's own outcomes, so your initial guesses get corrected on their device, not on a server.

It never touches the network, storage, DOM, timers or globals. Your app owns persistence and side effects; the library owns the math.

Install with `npm install oracular`, then:

```ts
import { createState, markRevealed, observe, shouldReveal } from 'oracular';
let state = createState({
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

With these numbers the offer fires after roughly six strong signals inside a week (p must clear 0.5 with a 90% lower bound); lower `priorStrength` or raise the weights to fire sooner.

That block is copied verbatim into the test suite, so it always runs.

## Contents

- [How it works](#how-it-works)
- [Examples](#examples)
- [API](#api)
- [Persistence](#persistence)
- [Explainability](#explainability)
- [Design rules](#design-rules)
- [Roadmap](#roadmap)

## How it works

### Intents are Beta distributions

You declare intents. Each has a `prior` probability and a `priorStrength` (how many observations the prior is worth). Internally an intent is a Beta(α, β) distribution with α₀ = prior × priorStrength and β₀ = (1 − prior) × priorStrength. Its current estimate is p = α / (α + β).

### Signals add evidence

Each intent maps event names to weights. A positive weight is evidence *for* the intent and is added to α; a negative weight is evidence *against* and its magnitude is added to β. Events the config doesn't mention cost nothing.

### Evidence decays toward the prior

Before any update or reading, the evidence decays by 2^(−Δt / halfLife), where Δt is the time since the intent was last updated. Only the *excess over the prior* decays: with no events, p drifts back to `prior` and α + β back to `priorStrength`. Someone who looked at pricing a month ago is not someone who looked at pricing today.

### The user's history corrects your weights

Events happen inside **episodes** (sessions). An episode ends when you call `endEpisode`, or on its own after `episodeTimeout` of inactivity. Signals seen in the episode are remembered per intent. When the intent's `outcome` event arrives, each remembered signal gets a **hit**; when the episode ends without it, each gets a **miss**. The engine also counts, per intent, how many episodes ended with and without the outcome: the intent's **base rate**.

A signal's weight is then a blend of your prior and the learned estimate:

```
q        = (hits + 1) / (hits + misses + 2)          Laplace-smoothed hit rate
b        = (outcomes + 1) / (episodes + 2)           Laplace-smoothed base rate
lift     = (q − b) / (1 − b)  if q ≥ b,  else  (q − b) / b     → in [−1, 1]
learned  = gain × |w₀| × lift                        0 until the signal has history
effective = (k × w₀ + n × learned) / (k + n)         n = hits + misses, k = priorEpisodes
```

`w₀` is your initial weight, `gain` (default 2) caps how far a perfectly predictive signal can grow, and `priorEpisodes` (default 10) is how many completed episodes it takes for the user's own history to count as much as your guess. A signal's strength and your confidence in it are separate knobs. Centering on the base rate matters: for an outcome that happens in 3% of sessions, a signal followed by it 30% of the time is strong evidence, not weak.

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

## API

Every function is pure: it never mutates its input and returns the same output for the same input. State is a plain, JSON-serializable object.

```ts
createState(config: EngineConfig): EngineState
observe(state, event: { name: string; at: number; props?: Record<string, unknown> }): EngineState
endEpisode(state, at: number): EngineState
predict(state, intent: string, at: number, opts?: RevealOptions): Prediction
shouldReveal(state, intent: string, at: number, opts?: RevealOptions): boolean
markRevealed(state, intent: string, at: number): EngineState
explain(state, intent: string, at: number): SignalExplanation[]
serialize(state): string
deserialize(json: string, opts?: { config?: EngineConfig; migrate?: Migrate }): EngineState
STATE_VERSION // 1
```

### Config

```ts
interface EngineConfig {
  intents: Record<string, IntentConfig>;
  episodeTimeout?: number;   // idle gap that ends an episode; off if omitted
  learning?: {
    halfLife?: number;       // forgetting of learned counts; off if omitted
    gain?: number;           // learned weight cap = gain × |initial|; default 2
    priorEpisodes?: number;  // pseudo-count behind your weights; default 10
  };
  reveal?: RevealOptions;    // defaults for every intent
}

interface IntentConfig {
  prior: number;                    // (0, 1)
  priorStrength: number;            // > 0
  halfLife: number;                 // > 0
  signals: Record<string, number>;  // event name → weight, non-zero
  outcome?: string;                 // event that confirms the intent
  resetOnOutcome?: boolean;         // default true
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
  effectiveWeight: number; // what the next occurrence will add
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

If you change the shape of the state itself across versions of this library, `deserialize` throws a `RangeError` unless you pass a `migrate` function, which receives the parsed object and its version and returns a current state:

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
//   { signal: 'pricing.viewed', contribution: 2.58, impact: 0.14, initialWeight: 3, learnedWeight: 2, effectiveWeight: 2.59, hits: 6, misses: 1 },
//   { signal: 'limit.hit',      contribution: 2,    impact: 0.10, initialWeight: 2, learnedWeight: 0, effectiveWeight: 2,    hits: 0, misses: 0 },
//   { signal: 'export.clicked', contribution: 0,    impact: 0,    initialWeight: 1, learnedWeight: 0, effectiveWeight: 0.5,  hits: 7, misses: 3 },
// ]
```

Rows are sorted by the size of their impact. `limit.hit` has no history yet, so its effective weight is exactly the initial one. `export.clicked` was followed by an upgrade exactly as often as any session was (7 of 10, the base rate), so this user's history says it carries no information, and its weight is on its way to zero. `pricing.viewed` beat the base rate, so it learned a positive weight; the blend is still below the initial 3 only because the developer's guess was higher than what seven episodes support so far.

## Design rules

- **Pure.** Inputs are never mutated; the same input always gives the same output. Internally, α and β are always the prior plus the sum of per-signal contributions, so `explain` adds up.
- **Portable.** No DOM, Node or React Native specific APIs; the source compiles against the ES2020 library alone. ESM and CommonJS builds with type declarations.
- **Private.** Nothing leaves the device because nothing *can*: there is no I/O in the library.
- **Honest about uncertainty.** `shouldReveal` needs both a high mean and a high lower bound.

## Roadmap

Not in 0.1, deliberately left room for: a React hook, a Vue composable, a devtools panel for watching `explain` live, and presets for common intents.

## License

[MIT](./LICENSE) © Ibrahim Ragab
