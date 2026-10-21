# FAQ

## Does it phone home?

No. The library contains no network, storage, DOM, timer or global access of any kind. The TypeScript source is compiled against the ES2020 standard library alone, with no DOM or Node type definitions, so code that tried to use `fetch` or `localStorage` would not even compile. You can verify at runtime on the [Playground](/playground): open the network tab and click; the engine makes no requests.

## Where does the data live?

In a plain JSON object your app holds and persists. `serialize(state)` is the whole of it, and it never includes event `props`. See [Persistence](/guide/persistence).

## What does "learns" mean if nothing is collected?

Learning is per user, on their device, from their own outcomes. The engine records, for each signal, how many of this user's episodes with the signal ended in the outcome and how many didn't, and adjusts the signal's weight for this user accordingly. No model is trained anywhere else and no data is pooled. See [Episodes & learning](/guide/concepts/episodes-and-learning).

## When do I call `endEpisode`?

On sign-out; otherwise let `episodeTimeout` end it. Set it (30 idle minutes is the usual web convention) and idle gaps close episodes on their own. Do not end an episode on `pagehide`, `visibilitychange` or the app going to the background: a short switch away is not a session boundary. Flush your pending save on those events instead. Without episodes ending there are no misses, and the engine cannot learn. See [Episodes & learning](/guide/concepts/episodes-and-learning#what-you-have-to-do).

## Why did Monday's session get a miss for Tuesday's upgrade?

Because learning is per episode: a signal earns a hit only when the outcome arrives in the same session. Set `attribution` on the intent and a session that ends without the outcome waits instead; when the outcome arrives inside the window, the session gets the share `2^(−age / halfLife)` of a hit, 0.906 for a day-old session with a one-week half-life. See [Episodes & learning](/guide/concepts/episodes-and-learning#credit-across-episodes).

## Can one event be a signal for several intents?

Yes, with different weights, and it can be the outcome of one intent and a signal of another. Each intent takes what it declares.

## What unit is time in?

Whatever you choose. `at` is a timestamp and every duration (`halfLife`, `cooldown`, `episodeTimeout`, `learning.halfLife`) is in the same unit. Milliseconds from `Date.now()` are the natural choice, and [`ms`](/api/variables/ms) spells them: `halfLife: ms.days(7)`. The library never reads a clock.

## What if the clock goes backwards?

Nothing breaks. An event stamped before the latest one is applied without decay, counting now at the engine's clock, and its stamp is held: a second event behind the clock confirms a correction and moves every anchor back to the first held stamp, while an event at or after the clock makes the held one a glitch that changed nothing. So a clock that was ahead heals two events after it is corrected, and a phone that woke up in 1970 before syncing loses no evidence and closes no session. No value becomes negative or NaN, and the test suite replays thousands of random sequences with backwards jumps to make sure. A reveal or outcome stamped ahead of the clock counts as having happened now. What no rule covers is a device that boots in 1970 and syncs forward later: one monotone jump of decades, indistinguishable from a long absence, so hold `observe` until the device clock is trusted. See [Decay → Clocks](/guide/concepts/decay#clocks).

## Can I change the config after shipping?

Yes. Pass the new config to `deserialize` on load. New weights apply, removed signals and intents are pruned (α and β are recomputed from what remains), new intents start at their prior, and everything learned about signals that still exist is kept. Loading without a config restores the old snapshot. See [Persistence](/guide/persistence#load-pass-your-current-config).

## How do I check a config before shipping it?

[`validateConfig(config)`](/api/functions/validateConfig) runs exactly the checks `createState` runs and returns the normalized copy, so call it in a test or at startup and a bad weight fails there, with the offending path in the message. For a config kept as JSON, point your editor at the published schema, <https://yuribenjamin.github.io/oracular/config.schema.json> (also shipped in the package as `oracular/config.schema.json`); `oracular replay` ignores the `$schema` key the file then carries, the engine does not.

## Why do I see `shouldReveal` false when p is high?

Three possible reasons, all visible in `predict`: `lower` has not cleared the threshold yet (evidence too thin), `revealed` is true (inside the cooldown after `markRevealed`), or `suppressedUntil` is set because the outcome just happened. See [Reveal & confidence](/guide/concepts/reveal-and-confidence) and [Outcomes & cooldowns](/guide/concepts/outcomes-and-cooldowns).

## Why did `confidence` go down when I added evidence?

`confidence` is `1 − 2·sd`, a heuristic. The standard deviation of a Beta distribution is largest near p = 0.5, so moving p from 0.05 toward 0.5 can widen it even though more is known. The engine decides with `lower`, not with `confidence`.

## Why is the lower bound sometimes 0?

`lower` is `p − z·sd`, clamped to [0, 1] ([Reveal & confidence](/guide/concepts/reveal-and-confidence#the-rule)). With a weak prior and little evidence the standard deviation is larger than p, so the normal approximation goes below zero and the clamp shows 0: the `willBuy` preset starts at p 0.048 with sd 0.096, the quickstart's `upgrade` at p 0.05 with sd 0.066. It means "too little evidence for a bound", which is also why `shouldReveal` is false there. With `bound: 'exact'`, the Beta distribution's own quantile, the lower bound is never exactly 0, though it can be vanishingly small when the prior is weak: Beta(0.192, 3.808), the `willBuy` preset's prior, gives about 1e-6. See [Normal or exact](/guide/concepts/reveal-and-confidence#normal-or-exact).

## How many sessions until learning matters?

Learning needs contrast: a signal is judged by comparing the sessions it appeared in with the sessions it did not, so the first confirmed session moves nothing, however it ended, and a signal seen in every session never moves ([Learning needs contrast](/guide/concepts/episodes-and-learning#learning-needs-contrast)). With the defaults, one session with the signal and the outcome followed by five with neither moves its weight by 1.7%; ten with and ten without, cleanly split, by 27%. `learning.priorEpisodes` (default 10) sets the pace: the same twenty sessions move the weight 58% at 2 and 7% at 50 ([Worked example](/guide/concepts/episodes-and-learning#worked-example)). In practice, a handful of sessions with the outcome and a handful without, so a few weeks for a weekly habit. On the [public clickstream](/guide/case-study-clickstream#scored-on-visitors-tune-never-saw), where 87% of visitors had one session, learning was worth two points of precision across everyone. Among the visitors with three or more sessions it was worth four points of precision and half again the recall with the printed config, and with the learning constants fit for that population the engine caught 27.9% of the orders at 48.9% precision, against 7.9% at 34.0% with learning off ([The rule a skeptic would write](/guide/case-study-clickstream#the-rule-a-skeptic-would-write)).

## How big is it?

About 24 kB minified and 8 kB gzipped, zero dependencies, under a 9 kB gzipped ceiling that [Stability and 1.0](/guide/stability) holds for the whole of 1.x. A state with a handful of intents serializes to a few kilobytes.

## Why a Beta distribution?

Because it is the simplest honest model of "a probability I'm unsure about": two numbers, a mean, a variance, and updates that are just additions. It gives a confidence bound for free, decays cleanly toward a prior, and is explainable term by term.

## Is it deterministic?

Completely. Same state, same events, same timestamps give the same result on every runtime. There is no randomness and no clock inside the library.

## Can I use it on a server?

Yes; the "device" is then the per-user record in your store, and the timestamp is whatever the client sent. The [frameworks page](/guide/frameworks#node) has a Node example. The privacy argument is weaker there by construction: it is your server holding the state.
