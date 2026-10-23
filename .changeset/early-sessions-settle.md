---
"oracular": minor
"@oracular/react": minor
---

Add `settleState(state, at)` to close expired sessions, settle expired attribution windows, and decay evidence and learned counts without recording an event. It advances the engine clock; the state format is unchanged.

The React store now uses a monotonic runtime clock anchored to restored history. It estimates an absence from the device clock only when the gap is nonnegative and at most `maxResumeGap` (30 days by default). Otherwise it continues from the latest saved history time, reports `getClockStatus() === 'held'`, and skips startup settlement. No network requests are made. Queued store-stamped operations retain their elapsed spacing when restored history adjusts their time base; explicit timestamps and `now` overrides remain caller-controlled.

Startup settlement is opt-in through `settleOnLoad: true` and uses the existing save debounce without making `load()` wait for a write. The default load/flush round trip writes nothing when state is unchanged. The React peer floor is `oracular >=0.18.0 <2`; the React release is a minor. A local development dependency keeps the unreleased workspace build usable. An isolated tarball smoke check rejects core 0.17 and exercises the minimum 0.18 candidate without source aliases.

The React runtime-clock support raises its size budgets to 2.6 kB for the hook/adapter path and 3.4 kB for all exports (measured 2.37 and 3.03 kB minified and gzipped). Core remains within its existing ceiling.
