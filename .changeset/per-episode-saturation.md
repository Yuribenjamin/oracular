---
"oracular": minor
---

Repeats of a signal within one episode now saturate when the config sets `episodeTimeout`. The n-th occurrence adds `w × log2(1 + 1/n)`, so n occurrences add `w × log2(1 + n)`: ten `pricing.viewed` are worth 3.46 weights, not ten. The count restarts when the episode ends or the intent's outcome arrives, so the same signal in a new session still counts in full. Learning is unchanged: hits and misses still count once per episode.

**This changes when reveals fire.** An intent whose evidence came from one signal repeated in one session now needs more. The quickstart's upgrade offer needs 32 `pricing.viewed` in one session, where it used to need 6; six in separate sessions still fire it. Two things to check after upgrading:

- **Saturation is on by default only when `episodeTimeout` is set.** Without an idle timeout, episodes end only when your app calls `endEpisode`, and an app that never does would otherwise discount a signal it saw yesterday; such configs keep their 0.2 behaviour. If your app ends every episode itself, set `saturate: true` on the intents that should saturate. The quickstart now sets `episodeTimeout: 30 * 60 * 1000`.
- **Opt out where repetition is the evidence.** Set the new intent option `saturate: false` for intents where repeating a signal is itself the evidence, such as a user stuck on the same step. Every occurrence then adds its full weight, exactly as in 0.2.

`STATE_VERSION` is now 2: the open episode also records how often each signal occurred (`EpisodeIntentRecord.counts`). `deserialize` migrates states saved by oracular 0.1.0 to 0.2.x on its own, keeping every estimate exactly as it was; your `migrate` function is only called for a version the library does not know. A version 2 state cannot be read by 0.2.x, so if you might roll back, catch the `RangeError` and fall back to `createState(config)`.
