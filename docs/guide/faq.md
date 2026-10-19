# FAQ

## Does it phone home?

No. The library contains no network, storage, DOM, timer or global access of any kind. The TypeScript source is compiled against the ES2020 standard library alone, with no DOM or Node type definitions, so code that tried to use `fetch` or `localStorage` would not even compile. You can verify at runtime on the [Playground](/playground): open the network tab and click; the engine makes no requests.

## Where does the data live?

In a plain JSON object your app holds and persists. `serialize(state)` is the whole of it, and it never includes event `props`. See [Persistence](/guide/persistence).

## What does "learns" mean if nothing is collected?

Learning is per user, on their device, from their own outcomes. The engine records, for each signal, how many of this user's episodes with the signal ended in the outcome and how many didn't, and adjusts the signal's weight for this user accordingly. No model is trained anywhere else and no data is pooled. See [Episodes & learning](/guide/concepts/episodes-and-learning).

## When do I call `endEpisode`?

When the session ends: `pagehide` on the web, the app going to the background on mobile, sign-out. Also set `episodeTimeout` as a safety net. Without episodes ending there are no misses, and the engine cannot learn. See [Episodes & learning](/guide/concepts/episodes-and-learning#what-you-have-to-do).

## Why did Monday's session get a miss for Tuesday's upgrade?

Because learning is per episode: a signal earns a hit only when the outcome arrives in the same session. Set `attribution` on the intent and a session that ends without the outcome waits instead; when the outcome arrives inside the window, the session gets the share `2^(−age / halfLife)` of a hit, 0.906 for a day-old session with a one-week half-life. See [Episodes & learning](/guide/concepts/episodes-and-learning#credit-across-episodes).

## Can one event be a signal for several intents?

Yes, with different weights, and it can be the outcome of one intent and a signal of another. Each intent takes what it declares.

## What unit is time in?

Whatever you choose. `at` is a timestamp and every duration (`halfLife`, `cooldown`, `episodeTimeout`, `learning.halfLife`) is in the same unit. Milliseconds from `Date.now()` are the natural choice, and [`ms`](/api/variables/ms) spells them: `halfLife: ms.days(7)`. The library never reads a clock.

## What if the clock goes backwards?

Nothing breaks. Events with an `at` earlier than the last update are applied without decay and the engine does not move its anchor back. No value becomes negative or NaN; the test suite replays thousands of random sequences with backwards jumps to make sure.

## Can I change the config after shipping?

Yes. Pass the new config to `deserialize` on load. New weights apply, removed signals and intents are pruned (α and β are recomputed from what remains), new intents start at their prior, and everything learned about signals that still exist is kept. Loading without a config restores the old snapshot. See [Persistence](/guide/persistence#load-pass-your-current-config).

## How do I check a config before shipping it?

[`validateConfig(config)`](/api/functions/validateConfig) runs exactly the checks `createState` runs and returns the normalized copy, so call it in a test or at startup and a bad weight fails there, with the offending path in the message. For a config kept as JSON, point your editor at the published schema, <https://yuribenjamin.github.io/oracular/config.schema.json> (also shipped in the package as `oracular/config.schema.json`); `oracular replay` ignores the `$schema` key the file then carries, the engine does not.

## Why do I see `shouldReveal` false when p is high?

Three possible reasons, all visible in `predict`: `lower` has not cleared the threshold yet (evidence too thin), `revealed` is true (inside the cooldown after `markRevealed`), or `suppressedUntil` is set because the outcome just happened. See [Reveal & confidence](/guide/concepts/reveal-and-confidence) and [Outcomes & cooldowns](/guide/concepts/outcomes-and-cooldowns).

## Why did `confidence` go down when I added evidence?

`confidence` is `1 − 2·sd`, a heuristic. The standard deviation of a Beta distribution is largest near p = 0.5, so moving p from 0.05 toward 0.5 can widen it even though more is known. The engine decides with `lower`, not with `confidence`.

## How big is it?

About 21 kB minified and 7.2 kB gzipped, zero dependencies. A state with a handful of intents serializes to a few kilobytes.

## Why a Beta distribution?

Because it is the simplest honest model of "a probability I'm unsure about": two numbers, a mean, a variance, and updates that are just additions. It gives a confidence bound for free, decays cleanly toward a prior, and is explainable term by term.

## Is it deterministic?

Completely. Same state, same events, same timestamps give the same result on every runtime. There is no randomness and no clock inside the library.

## Can I use it on a server?

Yes; the "device" is then the per-user record in your store, and the timestamp is whatever the client sent. The [frameworks page](/guide/frameworks#node) has a Node example. The privacy argument is weaker there by construction: it is your server holding the state.
