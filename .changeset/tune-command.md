---
"oracular": minor
---

**`npx oracular tune <log>... --config <file>`** seeds a config from a shadow log. Grouped by install, it reads what the engine itself counts, hits, misses and episode totals, off the state after every record, so it cannot disagree with what a device would learn from the same events. The base rate becomes the prior; the spread of per-install base rates becomes the prior strength (method of moments on a Beta, once the spread that sampling alone would produce is taken out; kept as it was below 10 installs); each declared signal's weight is `priorStrength × lift` over the episodes without it, with a 90% Wilson interval and the sample sizes on both sides; and the half-life that predicts the log best (lowest Brier score under `replay`) wins a grid search over 1h to 30d plus the current value. It prints the fit and the config to paste, which `replay --config` takes as it is.

Like replay, it counts shadow periods only: an episode in which any record was live is left out, a mixed log gets a warning, a live-only log is refused unless `--include-live` is passed. `--all-events` also measures every other event name in the log as a candidate signal; `--half-lives 12h,1d,3d` sets the grid; `--window` sets the scoring window when the intent has no cooldown. Every number is a starting point: the engine corrects the weights per user.

`oracular --help` now lists both commands; `oracular replay --help` and `oracular tune --help` have the options.
