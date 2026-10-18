---
"oracular": minor
---

Shadow mode is now a supported workflow: run oracular silently, record what it decides, and measure a config offline before any reveal is shown.

- **Recorder format and helpers.** `createRecord(state, event, { installId, mode })` returns one line of a versioned NDJSON log (`RECORD_VERSION` 1). Each line holds the event (`name`, `at`; `props` are never recorded) and, as a separate field, what the engine decided for every intent: `p`, `lower`, `shouldReveal`, `suppressedUntil`, the top signals by impact and the effective weights. `createEndRecord(at, options)` records an `endEpisode` call. Every record says whether reveals were `shadow` or `live`. The install id comes from your app (random, generated once, stored); the helpers are pure and generate nothing.
- **`npx oracular replay <log>... --config <file>`.** Replays the logged events through the engine under any config, and reports per intent and threshold: precision, recall, median lead time from reveal to outcome, reveals per user, and a reliability table with a Brier score. Only shadow periods are scored: a log with live records gets a warning, and a log of nothing but live records is refused unless `--include-live` is passed. The command ships as the package's `bin`, still with zero runtime dependencies.

The new Shadow mode guide describes the workflow and the record format.
