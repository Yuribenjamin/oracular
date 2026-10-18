---
"oracular": minor
---

Three small ergonomics for writing configs.

- **`validateConfig(config)`** runs the checks `createState` and `deserialize` run, without building a state, and returns the normalized copy they would store. It accepts `unknown`, so parsed JSON can be passed as it is; use it to fail fast at startup or in a test.
- **`ms`**: `ms.seconds(n)`, `ms.minutes(n)`, `ms.hours(n)`, `ms.days(n)` and `ms.weeks(n)` spell durations in milliseconds, so `halfLife: ms.days(7)` replaces `7 * 24 * 60 * 60 * 1000`. Plain multiplications, nothing else.
- **A JSON Schema for the config**, shipped in the package as `oracular/config.schema.json` and served at https://yuribenjamin.github.io/oracular/config.schema.json, for completion and checks on a config kept as JSON. `oracular replay --config file.json` now ignores a top-level `$schema` key, so a file can point at the schema and still be the config the engine runs.
