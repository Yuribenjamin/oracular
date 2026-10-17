# Changelog

## 0.2.1

### Patch Changes

- [#10](https://github.com/Yuribenjamin/oracular/pull/10) [`04fb9aa`](https://github.com/Yuribenjamin/oracular/commit/04fb9aad298287fd280a28608f175290db691208) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Fix the `exports` map: the `default` condition now points at the CommonJS build and stays last, so resolvers without an `import`/`require` condition (Jest's jsdom environment, some bundlers) get a file they can load. ESM-first resolvers still get the ESM build.

## 0.2.0

### Minor Changes

- [#8](https://github.com/Yuribenjamin/oracular/pull/8) [`72c5f3c`](https://github.com/Yuribenjamin/oracular/commit/72c5f3c296c80ed99f8def26cdb120cdbfc239b3) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Learning compares a signal's outcome rate against sessions without the signal, and only trusts the comparison once both have been seen. Weights no longer drift after a single outcome.

## 0.1.2

### Patch Changes

- [#6](https://github.com/Yuribenjamin/oracular/pull/6) [`57d121f`](https://github.com/Yuribenjamin/oracular/commit/57d121f107f4ed92f2e59bf354cc6e19f705de1b) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Docs corrections from the first production integration; new evaluate(), evidenceToReveal(), episodeClosed() and explain() filtering; default export condition.

## 0.1.1

### Patch Changes

- [#3](https://github.com/Yuribenjamin/oracular/pull/3) [`b5670db`](https://github.com/Yuribenjamin/oracular/commit/b5670db087d4e63a7a6c74366c9b751b1dd05e9b) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - No library changes. First version published through the automated release pipeline, with npm provenance attestation.

## 0.1.0

First release. Published as [v0.1.0](https://github.com/Yuribenjamin/oracular/releases/tag/v0.1.0).

### Minor Changes

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
