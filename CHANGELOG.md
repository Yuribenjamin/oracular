# Changelog

All notable changes to `oracular` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-17

First release.

### Added

- `createState`, `observe`, `endEpisode`: intents tracked as Beta(α, β) with per-signal
  weights, exponential decay back toward the prior, and episode bookkeeping (explicit end or
  `episodeTimeout`).
- On-device learning: every signal seen in an episode gets a hit when the intent's outcome
  arrives and a miss when the episode ends without it. The learned weight is centered on the
  intent's own base rate and blended with the developer's weight by `learning.priorEpisodes`.
- `predict`, `shouldReveal`, `markRevealed`: reveal only when p and the lower confidence bound
  p − z·sd both clear the threshold, with a cooldown after each reveal.
- `resetOnOutcome` (default on): the outcome event resets an intent's evidence to the prior
  while keeping what was learned.
- Outcome cooldown: the outcome event is recorded as `lastOutcomeAt` and `shouldReveal` stays
  false for the intent's cooldown afterwards; `predict` reports `suppressedUntil`, the end of
  whichever cooldown (reveal or outcome) is still running.
- `explain`: per-signal contribution, impact on p, initial, learned and effective weights.
- `serialize` / `deserialize` with a `version` field, a `migrate` hook, and a `config` option
  that swaps in the app's current config and prunes signals and intents no longer declared.
- ESM and CommonJS builds with type declarations; runs unchanged in browsers, Node 18+ and
  React Native.

[0.1.0]: https://github.com/Yuribenjamin/oracular/releases/tag/v0.1.0
