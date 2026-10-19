# Changelog

## 0.7.1

### Patch Changes

- [#42](https://github.com/Yuribenjamin/oracular/pull/42) [`44fee50`](https://github.com/Yuribenjamin/oracular/commit/44fee509d28f5c7ad6ef77a53cfa5952db50560b) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **A load then a save writes the same string.** `deserialize` rebuilt the open episode's per-intent records in the order the config lists intents, while `observe` writes them in the order the intents were first touched in that episode. The content was identical, and the order of keys in a serialized state is not API, but an app that skips a save when the string has not changed, a common persistence pattern, wrote once spuriously after every load. `deserialize` now keeps the stored order and drops only intents the config no longer declares, so `serialize(deserialize(json))` is `json` on the first pass. The property-based tests pin it.

## 0.7.0

### Minor Changes

- [#36](https://github.com/Yuribenjamin/oracular/pull/36) [`a585808`](https://github.com/Yuribenjamin/oracular/commit/a58580846d39fa14269096fa3e4f0891749eee88) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Inspect.** `inspect(state, at, opts?)` in the main entry returns every intent's prediction, gate and explanation as one object, in config order. `oracular/inspect` renders that snapshot: `renderInspector` as an HTML fragment with inline styles and every string escaped, `mountInspector` into anything with an `innerHTML`, with `update` and `unmount`; neither touches a DOM API or sets a timer, and neither carries engine code. The subpath is experimental, as the stability page says: its markup and options may change in a minor. The types `Snapshot` and `IntentSnapshot` are exported from the main entry.

- [#36](https://github.com/Yuribenjamin/oracular/pull/36) [`a585808`](https://github.com/Yuribenjamin/oracular/commit/a58580846d39fa14269096fa3e4f0891749eee88) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Presets.** `oracular/presets` exports `presets`, four plain `IntentConfig` objects to spread into your config and override: `willBuy`, tuned by `oracular tune` on a public e-commerce clickstream of 2.7 million events (one shop, May to September 2015, 4.8% of sessions ending with an order; prior 0.048, strength 4, `cart.added` 2.3, half-life one hour, 181,080 sessions behind it), and `upgrade`, `stuck` and `churn`, the documentation's running examples, hand-written and labelled so. `presetSources` carries each preset's provenance as data, and the types `PresetName` and `PresetSource` are exported from the main entry.

### Patch Changes

- [#36](https://github.com/Yuribenjamin/oracular/pull/36) [`a585808`](https://github.com/Yuribenjamin/oracular/commit/a58580846d39fa14269096fa3e4f0891749eee88) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Rollback.** `deserialize` reads a state one version newer than `STATE_VERSION` as the current one, ignoring the fields it does not know, so a rollback by one release keeps every user's history. The rule that allows it, a state version bump only adds fields, is now a commitment on the new stability page, together with what counts as public API, how versions are read before 1.0, the deprecation rule, the state-format guarantee, the 1.0 criteria and their status, and a 7 kB ceiling for the core. Two versions ahead still throws the `RangeError`, and `migrate` is still consulted for it. From now on the changeset of every state version bump says what an older reader silently loses; this release bumps nothing, so a 0.6 reader loses nothing but was never able to read ahead.

## 0.6.0

### Minor Changes

- [#32](https://github.com/Yuribenjamin/oracular/pull/32) [`6951d70`](https://github.com/Yuribenjamin/oracular/commit/6951d70b4ff1e654ab17a61357d882fd82240968) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Cross-episode attribution.** `IntentConfig.attribution` is how long a closed episode's signals wait for the outcome before they take a miss. Until now a signal earned a hit only when the outcome arrived in the same episode, so for an intent that builds over days the sessions that built it took misses and the session where the user acted got all the credit. With a window set, an episode that ends without the outcome is held instead of counted; when the outcome arrives inside the window, each held episode gets the share `2^(−age / halfLife)` of a hit that its evidence still holds, and the rest of a miss, so every episode still counts exactly once and the contrast that learning rests on is unchanged; when the window passes, the episode is a miss recorded at the moment the window ended. Reads settle what has expired in what they show and store nothing. Off unless set: every state and estimate without `attribution` is exactly what it was.
  
  **State version 3.** `IntentState.pending` lists the episodes waiting, at most 32 per intent (past that the oldest is a miss at once). `deserialize` upgrades version 1 and 2 states on its own, adding an empty list and changing no number; oracular 0.5.x cannot read a version 3 state, so the rollback advice stays: catch and start from `createState(config)`. `PendingEpisode` is exported as a type; the config JSON Schema gains `attribution`.
  
  `oracular tune` counts each episode's own verdict, with the window off while counting, keeps it on for the half-life grid, and keeps whatever `attribution` you set in the printed config.

## 0.5.2

### Patch Changes

- [#30](https://github.com/Yuribenjamin/oracular/pull/30) [`8be17e0`](https://github.com/Yuribenjamin/oracular/commit/8be17e032bb1b7886ce1d7278701555c39bb03cf) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - `oracular tune` learned three rules from a public e-commerce clickstream of 2.7 million events. A signal seen in more than 90% of counted episodes is left out of the fitted config, whatever its lift: it cannot tell episodes apart, and the few episodes without it are rarely typical sessions, so the contrast measured on them says little (on that log, `item.viewed` sat in 99% of sessions and the contrast called it strongly negative; dropping it scored better than any weight). The current half-life is kept when the best grid point improves on it by less than 1%, and the grid is printed to four decimals so a flat grid reads as flat. The report says when the fitted intent still does not beat its own base rate. The JSON report gains `share` and `ubiquitous` per signal and `beatsBaseRate` per intent.

## 0.5.1

### Patch Changes

- [#28](https://github.com/Yuribenjamin/oracular/pull/28) [`250a32d`](https://github.com/Yuribenjamin/oracular/commit/250a32d9764aeabdff020f99074c0a512ea7194f) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - `oracular replay` and `oracular tune` read logs of any size. A log of more than about a hundred thousand records made both commands fail with "Maximum call stack size exceeded", because every file's entries were spread into one `push` call. Found by replaying the Retailrocket clickstream (2.7 million events).

## 0.5.0

### Minor Changes

- [#24](https://github.com/Yuribenjamin/oracular/pull/24) [`7809c6a`](https://github.com/Yuribenjamin/oracular/commit/7809c6af5c26ec836e43b76eac647bcf85c42514) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **`npx oracular tune <log>... --config <file>`** seeds a config from a shadow log. Grouped by install, it reads what the engine itself counts, hits, misses and episode totals, off the state after every record, so it cannot disagree with what a device would learn from the same events. The base rate becomes the prior; the spread of per-install base rates becomes the prior strength (method of moments on a Beta, once the spread that sampling alone would produce is taken out; kept as it was below 10 installs); each declared signal's weight is `priorStrength × lift` over the episodes without it, with a 90% Wilson interval and the sample sizes on both sides; and the half-life that predicts the log best (lowest Brier score under `replay`) wins a grid search over 1h to 30d plus the current value. It prints the fit and the config to paste, which `replay --config` takes as it is.
  
  Like replay, it counts shadow periods only: an episode in which any record was live is left out, a mixed log gets a warning, a live-only log is refused unless `--include-live` is passed. `--all-events` also measures every other event name in the log as a candidate signal; `--half-lives 12h,1d,3d` sets the grid; `--window` sets the scoring window when the intent has no cooldown. Every number is a starting point: the engine corrects the weights per user.
  
  `oracular --help` now lists both commands; `oracular replay --help` and `oracular tune --help` have the options.

## 0.4.0

### Minor Changes

- [#22](https://github.com/Yuribenjamin/oracular/pull/22) [`0bb5841`](https://github.com/Yuribenjamin/oracular/commit/0bb5841fb93d2f16dcac74601f1ee218b70dda0e) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Three small ergonomics for writing configs.
  
  - **`validateConfig(config)`** runs the checks `createState` and `deserialize` run, without building a state, and returns the normalized copy they would store. It accepts `unknown`, so parsed JSON can be passed as it is; use it to fail fast at startup or in a test.
  - **`ms`**: `ms.seconds(n)`, `ms.minutes(n)`, `ms.hours(n)`, `ms.days(n)` and `ms.weeks(n)` spell durations in milliseconds, so `halfLife: ms.days(7)` replaces `7 * 24 * 60 * 60 * 1000`. Plain multiplications, nothing else.
  - **A JSON Schema for the config**, shipped in the package as `oracular/config.schema.json` and served at https://yuribenjamin.github.io/oracular/config.schema.json, for completion and checks on a config kept as JSON. `oracular replay --config file.json` now ignores a top-level `$schema` key, so a file can point at the schema and still be the config the engine runs.

## 0.3.0

### Minor Changes

- [#18](https://github.com/Yuribenjamin/oracular/pull/18) [`d2d95a4`](https://github.com/Yuribenjamin/oracular/commit/d2d95a4f3409280d999500f42851772cf2b6a767) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - `deserialize` now rejects, with a `RangeError`, a stored state whose numbers are each finite but too large to compute with. Before, a contribution or episode count near 1e308 (a corrupted or hand-edited state) loaded and then answered NaN. Config validation now caps signal weights, `priorStrength`, `learning.gain` and `learning.priorEpisodes` at 1e6 in magnitude (`RangeError`), because larger values could overflow the same arithmetic in `createState` too; no real config comes close. A fuzz test over states saved by every published version (0.1.0 to 0.2.1) guards both: corrupt, truncated and tampered input either throws a `SyntaxError`, `TypeError` or `RangeError`, or loads a state whose estimates stay finite.

- [#18](https://github.com/Yuribenjamin/oracular/pull/18) [`d2d95a4`](https://github.com/Yuribenjamin/oracular/commit/d2d95a4f3409280d999500f42851772cf2b6a767) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Repeats of a signal within one episode now saturate when the config sets `episodeTimeout`. The n-th occurrence adds `w × log2(1 + 1/n)`, so n occurrences add `w × log2(1 + n)`: ten `pricing.viewed` are worth 3.46 weights, not ten. The count restarts when the episode ends or the intent's outcome arrives, so the same signal in a new session still counts in full. Learning is unchanged: hits and misses still count once per episode.
  
  **This changes when reveals fire.** An intent whose evidence came from one signal repeated in one session now needs more. The quickstart's upgrade offer needs 32 `pricing.viewed` in one session, where it used to need 6; six in separate sessions still fire it. Two things to check after upgrading:
  
  - **Saturation is on by default only when `episodeTimeout` is set.** Without an idle timeout, episodes end only when your app calls `endEpisode`, and an app that never does would otherwise discount a signal it saw yesterday; such configs keep their 0.2 behaviour. If your app ends every episode itself, set `saturate: true` on the intents that should saturate. The quickstart now sets `episodeTimeout: 30 * 60 * 1000`.
  - **Opt out where repetition is the evidence.** Set the new intent option `saturate: false` for intents where repeating a signal is itself the evidence, such as a user stuck on the same step. Every occurrence then adds its full weight, exactly as in 0.2.
  
  `STATE_VERSION` is now 2: the open episode also records how often each signal occurred (`EpisodeIntentRecord.counts`). `deserialize` migrates states saved by oracular 0.1.0 to 0.2.x on its own, keeping every estimate exactly as it was; your `migrate` function is only called for a version the library does not know. A version 2 state cannot be read by 0.2.x, so if you might roll back, catch the `RangeError` and fall back to `createState(config)`.

- [#18](https://github.com/Yuribenjamin/oracular/pull/18) [`d2d95a4`](https://github.com/Yuribenjamin/oracular/commit/d2d95a4f3409280d999500f42851772cf2b6a767) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - Shadow mode is now a supported workflow: run oracular silently, record what it decides, and measure a config offline before any reveal is shown.
  
  - **Recorder format and helpers.** `createRecord(state, event, { installId, mode })` returns one line of a versioned NDJSON log (`RECORD_VERSION` 1). Each line holds the event (`name`, `at`; `props` are never recorded) and, as a separate field, what the engine decided for every intent: `p`, `lower`, `shouldReveal`, `suppressedUntil`, the top signals by impact and the effective weights. `createEndRecord(at, options)` records an `endEpisode` call. Every record says whether reveals were `shadow` or `live`. The install id comes from your app (random, generated once, stored); the helpers are pure and generate nothing.
  - **`npx oracular replay <log>... --config <file>`.** Replays the logged events through the engine under any config, and reports per intent and threshold: precision, recall, median lead time from reveal to outcome, reveals per user, and a reliability table with a Brier score. Only shadow periods are scored: a log with live records gets a warning, and a log of nothing but live records is refused unless `--include-live` is passed. The command ships as the package's `bin`, still with zero runtime dependencies.
  
  The new Shadow mode guide describes the workflow and the record format.

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
