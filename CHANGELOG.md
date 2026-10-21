# Changelog

## 0.12.0

### Minor Changes

- [#62](https://github.com/Yuribenjamin/oracular/pull/62) [`0502b78`](https://github.com/Yuribenjamin/oracular/commit/0502b789049cb8ef8643af587ec94b78ce0c39b1) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **The clock rule: one glitch cannot move the engine.** 0.10.0 made every write trust the latest event's time, so that one event stamped in the future could no longer hold an intent until the clock caught up. A production re-test found the cost: a clock that steps *backwards* (a phone that wakes up in 1970 before it syncs, a seconds-for-milliseconds bug) pulled every anchor back with it, and the next event decayed the whole gap again and closed the session, recording a miss nobody earned. The two cases are one ambiguity: after one backward step the engine cannot tell whether the new stamp or the old anchor is the wrong clock. It now waits one event. The engine keeps a clock, the latest event time it trusts; an event stamped behind it counts now, at the clock's time, and its stamp is held. If the next event is also behind the clock, the clock was corrected: every anchor ahead of the held stamp (evidence, learned counts, reveals, outcomes, the open episode, the episodes waiting under `attribution`) moves back to it, and decay and cooldowns resume from there. If the next event is at or after the clock, the held stamp was a glitch, and nothing moved. Monotone clocks see no difference at all, and every number in the docs is unchanged. What changes: a clock that was ahead heals two events after it is corrected rather than one, and heals every intent at once rather than only the ones later events touch; a reveal stamped ahead of the clock is pinned by the next event on any intent; a single backward stamp wipes nothing and closes nothing.
  
  Two costs, stated. The first event after a correction is processed at the uncorrected time, so the intents it touches are decayed to that time and their episodes waiting under `attribution` can settle as misses before the second event moves everything back. And two bad stamps in a row read as a correction, which costs exactly what 0.10 paid on every backward step: the anchors move to the bad time and the next good event decays the gap again. One case no rule covers: a device that boots in 1970 and syncs forward later makes one monotone jump of decades, indistinguishable from a long absence, so hold `observe` until the device clock is trusted.
  
  **State version 4.** The clock is stored, so `STATE_VERSION` is 4 and version 3 states (0.6.0 to 0.11.x) migrate on load: the clock is set to the latest time the stored anchors were written at, nothing is held, and no estimate changes. Under rule 5 of the stability policy, 0.11 reads a version 4 state as its own; what it loses is the clock: a backward stamp awaiting confirmation is forgotten, and the next event is trusted the way 0.11 trusted every event.

### Patch Changes

- [#62](https://github.com/Yuribenjamin/oracular/pull/62) [`0502b78`](https://github.com/Yuribenjamin/oracular/commit/0502b789049cb8ef8643af587ec94b78ce0c39b1) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Size.** The whole `oracular` entry goes from 7.72 kB to 8.09 kB minified and gzipped with the clock rule and its state version, the quickstart import (`createState`, `observe`, `shouldReveal`, `markRevealed`) from 4.63 kB to 4.85 kB. That crosses the 7.9 kB ceiling the stability page set in 0.8, so the ceiling moves as it did then, to the shipped size plus about 10%: 8.9 kB, with the quickstart budget at 5 kB.

- [#62](https://github.com/Yuribenjamin/oracular/pull/62) [`0502b78`](https://github.com/Yuribenjamin/oracular/commit/0502b789049cb8ef8643af587ec94b78ce0c39b1) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Presets are read-only in the types too.** `presets` and `presetSources` are `DeepReadonly<...>`, matching the frozen objects: assigning into a preset is a type error, spreading one is unchanged.

## 0.11.0

### Minor Changes

- [#58](https://github.com/Yuribenjamin/oracular/pull/58) [`d6d1e87`](https://github.com/Yuribenjamin/oracular/commit/d6d1e87e176fc0112384e47fb4782e12d6fa1d1a) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Learning no longer drifts without outcomes.** The outcome rates a signal is judged by, with it and without it, were Laplace-smoothed, which centres both on 0.5 with one pseudo-hit each: two groups with no outcome at all then differ only by their sizes, so with zero outcomes a common signal drifted negative and a rare one positive, and a weight could change sign on no evidence (a weight of 2 seen in 90 of 100 outcome-free episodes ended at −0.59). Both rates are now shrunk toward the intent's own base rate by two pseudo-episodes, `(hits + 2·q₀) / (n + 2)` with `q₀ = outcomes / episodes`: a signal whose outcome rate equals the base rate learns exactly zero whatever the sample sizes, with no outcome every rate is 0 and no weight moves away from the developer's, and a weight never changes sign without outcomes on at least one side. The association-rule baseline becomes the base rate itself. `tune` fits with the same smoothing, so its weights, intervals and lifts move a little on small samples (a signal seen once with the outcome over a low base rate is worth a little less than before); on large samples the change is in the third decimal. Every learned number in the documentation's generated tables was regenerated. The state format is unchanged, and existing learned counts are kept: only the weight read from them moves.

## 0.10.0

### Minor Changes

- [#56](https://github.com/Yuribenjamin/oracular/pull/56) [`1529d8e`](https://github.com/Yuribenjamin/oracular/commit/1529d8e1568d79959afc7573ba8fa6e7f3e7ff59) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Configs that cannot work are refused.** `createState`, `validateConfig` and the `config` passed to `deserialize` now throw for a reveal `threshold` of 0 or 1 (`RangeError`, strictly between 0 and 1), a `z` above 10 (`RangeError`; 3.09 is already a one-sided 99.9% bound, and 128 is a misplaced 1.28), and an `outcome` that is also one of the intent's own signals while `resetOnOutcome` is on (`TypeError`: the reset wipes the evidence the signal just added; set `resetOnOutcome: false` to keep such a signal, which then reads as "did it once, will again"). The JSON Schema says the same. Per-call reveal options keep accepting 0 and 1, since a probe such as `evidenceToReveal` at those values is a legitimate question. A stored state whose config predates these checks still loads: `deserialize` reads the stored config without them and replaces it with the one you pass. An intent with no signals stays accepted; it is a prior-only gate. The presets in `oracular/presets` are now frozen through and through, so a change by one caller cannot reach every other; spread one to change a value, as the guide shows.
  
  **Size.** The checks, the anchor pin and the duplicate-outcome rule add about 0.2 kB: the core goes from 7.5 kB to 7.72 kB minified and gzipped, under the 7.9 kB ceiling, and the quickstart entry (`createState`, `observe`, `shouldReveal`, `markRevealed`) from 4.43 kB to 4.63 kB, past its 4.5 kB budget, which moves to 4.7 kB.

- [#56](https://github.com/Yuribenjamin/oracular/pull/56) [`1529d8e`](https://github.com/Yuribenjamin/oracular/commit/1529d8e1568d79959afc7573ba8fa6e7f3e7ff59) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **A clock that was ahead no longer freezes an intent.** A production audit found that one event stamped in the future (a device clock that was wrong for a moment) held an intent until the clock caught up: decay stopped, because the anchor kept the later time; the open episode never timed out, so learning stopped; and a reveal or outcome stamped in the future kept the gate shut until that date plus the cooldown. Every write now moves its anchor to the event's own time, even when that is earlier: the evidence is held (no decay for a backwards step, as before) and decay resumes from the new time, for `updatedAt`, the learned counts' `learnedAt` and the episode's `lastEventAt`. A reveal or outcome stamped ahead of the clock counts as having happened now: `predict` reports `suppressedUntil` one cooldown after the current time rather than years ahead, and the next event pins the stored time to its own. `markRevealed` follows the same rule and trusts the time it is given, so an earlier `at` moves the cooldown start back. What moves for a clock that only ever runs forward: nothing. What moves for one that jumps backwards: the anchor now follows it, so a log replayed with timestamps out of order decays slightly more than before. `decayFactor` of an infinite gap is now 0, not 1. An episode held under `attribution` with a close stamped in the future is left as it was.

- [#56](https://github.com/Yuribenjamin/oracular/pull/56) [`1529d8e`](https://github.com/Yuribenjamin/oracular/commit/1529d8e1568d79959afc7573ba8fa6e7f3e7ff59) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **A repeated outcome counts once.** An outcome rewards the signals seen since the episode started or since the intent's outcome last arrived, and counts the episode toward the base rate. A second outcome event with no signal seen since the first (a duplicate event, or two outcomes back to back) counted another hit episode, so a session with two outcome events inflated the base rate; it now counts nothing, and only `lastOutcomeAt` and the reset of the evidence happen again. Signals seen after an outcome in the same episode are unchanged: they earn a hit if another outcome follows them, and stay neutral at the close, since what they would predict is a second outcome in the same session, which is not what the weight is for. `tune` counts the same way. The state format is unchanged.

- [#56](https://github.com/Yuribenjamin/oracular/pull/56) [`1529d8e`](https://github.com/Yuribenjamin/oracular/commit/1529d8e1568d79959afc7573ba8fa6e7f3e7ff59) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **`tune` no longer reports a lift with nothing to compare it to.** A signal seen in every counted episode had its outcome rate compared with a smoothed rate over zero episodes, a made-up 0.5, and the report printed a lift and a 90% interval from it. For such a signal `lift`, `score`, `low` and `high` are now `null` in `--json`, and the text report prints "no contrast" in place of the interval; the weight was already left out as ubiquitous.

### Patch Changes

- [#56](https://github.com/Yuribenjamin/oracular/pull/56) [`1529d8e`](https://github.com/Yuribenjamin/oracular/commit/1529d8e1568d79959afc7573ba8fa6e7f3e7ff59) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Two CLI fixes.** `replay` and `tune` no longer refuse a whole config because one intent has a reveal cooldown of 0: that intent is scored over its half-life, the text report says so, and the `--json` reports gain `windowSource` (`option`, `cooldown` or `halfLife`) next to the existing `windowIsCooldown`. `oracular replay --version` and `oracular tune --version` (or `-v`) print the version, as the help already claimed.

## 0.9.0

### Minor Changes

- [#52](https://github.com/Yuribenjamin/oracular/pull/52) [`e8ea457`](https://github.com/Yuribenjamin/oracular/commit/e8ea457b29edd23d0cda8446d6826ad45478b9b9) Thanks [@omaremam](https://github.com/omaremam)! - **Choosing the comparison.** `learning.lift` chooses how a signal's outcome rate is compared with its baseline: absolute difference, relative lift, risk ratio, log lift, odds ratio, normalized difference or association-rule lift. Every choice becomes a signed score in [−1, 1], with no association at zero, before it changes a weight. A risk ratio of 1 learns zero, 3 gives a score of 0.5 and 1/3 gives −0.5; `gain` caps the learned magnitude at `gain × |initial weight|` whichever comparison is set. `oracular tune` uses the same score for weights and intervals, and reports the raw measure alongside it when the two differ. Nothing moves unless the option is set: normalized difference remains the default, with exactly the same arithmetic.
  
  **Rollback.** A stored config that sets `lift` is read by 0.9 and later; a 0.8 reader throws a `TypeError` on the unknown key, so remove `learning.lift` from the saved config before rolling a deploy back. Passing an older config to `deserialize` alone does not avoid that check. The state version is unchanged. Existing learned counts are kept; evidence already accumulated under another comparison is not rebuilt and continues to decay or reset on outcome.

## 0.8.1

### Patch Changes

- [#46](https://github.com/Yuribenjamin/oracular/pull/46) [`d796e99`](https://github.com/Yuribenjamin/oracular/commit/d796e990fed2b15d2fbf9afa1744782f9da41433) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Release tags.** From this release, each release is tagged `oracular@<version>` instead of `v<version>`, and the GitHub release that goes with it is created per package. The reason is the repository's shape: it is now an npm workspace, with the root still the `oracular` package, so that a second package can be published from it; Changesets names tags that way in a workspace, and this release is the one that proves the pipeline end to end before anything depends on it. Nothing in the library changes. What also does not change: the existing `v0.1.0` to `v0.8.0` tags stay where they are, and there is no `v` alias for new releases. If you pin by tag, `oracular@0.8.1` is the first of the new form, and from here on the tag is the package name followed by the version.

## 0.8.0

### Minor Changes

- [#44](https://github.com/Yuribenjamin/oracular/pull/44) [`912f60d`](https://github.com/Yuribenjamin/oracular/commit/912f60da297fe01a64decc1f91916cdcd3a98c60) Thanks [@Yuribenjamin](https://github.com/Yuribenjamin)! - **Exact lower bound.** `RevealOptions.bound: 'exact'` makes `lower` the Beta distribution's own quantile at the one-sided level `z` names (Φ(−z), so 1.28 is still a 90% bound) instead of the normal approximation p − z·sd, which is optimistic exactly where the gate matters: thin evidence near the threshold. Beta(4, 3) puts p at 0.571, the approximation at 0.347 and the exact tenth percentile at 0.333; by Beta(30, 20) the two agree to a thousandth. `predict`, `shouldReveal`, `evaluate`, the recorder and `evidenceToReveal` all follow the option, resolved per call → intent → engine → default like the others, and the config schema lists it. Nothing moves unless it is set: every state and every number without `bound` is exactly what it was. Under `'exact'`, `z: 0` is the median rather than the mean, and `lower` can sit above `p` for a prior near 1 with little strength. A stored config that sets `bound` is read by 0.8 and later; 0.7 throws a `TypeError` on the unknown key, so drop the option before rolling a deploy back. The state version is unchanged. The quantile costs 0.54 kB: the core goes from 6.65 kB to 7.19 kB minified and gzipped, past the 7 kB ceiling the stability page set, so the ceiling moves once, to 7.9 kB (the shipped size plus about 10%), and the quickstart budget from 3.9 kB to 4.5 kB; the stability page records the decision.

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
