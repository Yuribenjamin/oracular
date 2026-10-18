# oracular roadmap

Oracular is an on-device intent engine: your app learns when the user is ready, and nothing leaves the device. This roadmap says what we are building next and why, in order. It is a statement of priorities, not a schedule; items move when real integrations show they should.

## Principles that decide what gets in

- **Nothing leaves the device.** No feature may require a network call, a vendor, a device fingerprint, or cross-user data. Requests that need any of those get a polite no, however reasonable they sound.
- **Pure core, thin helpers.** The engine stays `(state, event) → state`. Anything with I/O lives outside the core, in documented patterns or small optional helpers.
- **Earn features from integrations.** A feature enters the roadmap when a real app needed it, not when it sounds useful. Two production integrations exist today; the third decides the shape of any framework binding.
- **Honest about the model.** The docs say what the engine can and cannot learn, and every number in a tuning table is generated from the engine's own math.

## Now: 0.3

The theme is **proof**. Both integrations so far had to invent the same thing: a shadow mode that records what the engine would have done. Make that a first-class workflow, so a team can run oracular silently, export a log, measure it offline, tune, and only then switch a reveal on.

1. **Recorder format and helper.** A documented, versioned NDJSON format plus a tiny pure helper that produces a record from a state and an event. Apps own the storage and the export; the format is ours. Three details are fixed now because 0.4 depends on them:
   - Every record carries an **install id**: random, generated locally on first use, stored by the app, never derived from device characteristics. It lets `tune` group records per user across exports and nothing else; it is not a fingerprint and the docs say so.
   - **Events and decisions are separable fields.** The raw event (`at`, name) is what `replay` recomputes from under a new config; the recorded decision (p, lower, shouldReveal, suppressedUntil, top signals by impact, effective weights) is for comparing what shipped against what would have shipped, never an input.
   - Every record says whether reveals were **shadow or live** at the time, so tools can tell measurement from intervention.
2. **`npx oracular replay`.** Reads a recorder log and a config, replays the events through the engine, and reports per intent and per threshold: precision, recall, lead time from reveal to outcome, reveals per user, and a reliability table (predicted p vs observed outcome rate, with a Brier score). This is the artefact that convinces a product owner in ten minutes, and the input to every tuning decision. Its metrics are only honest on shadow periods: once a reveal is live, the reveal itself causes outcomes and precision is contaminated. `replay` warns on mixed logs and refuses to score live periods unless told to.
3. **Per-episode saturation.** Repeating a signal in one episode must not add its full weight every time (ten `pricing.viewed` is not thirty pseudo-counts). Decide the rule (log-saturating contribution is the leading option), make it the default, add tests and a tuning-guide section. This needs a per-signal count per episode in the state, so it is the first `STATE_VERSION` bump with production state in the wild, and it ships together with item 4.
4. **State robustness.** Fixtures of a serialized state from every published version in `tests/fixtures/`, each of which must deserialize and migrate to the current version; the migration for the saturation change; and a fuzz test that feeds `deserialize` corrupt, truncated and tampered JSON and asserts it never yields NaN or Infinity and throws only the documented error types. Apps load this state from storage on every launch, so this is not optional.
5. **Packaging checks in CI.** `publint`, `@arethetypeswrong/cli` and `size-limit` with a hard budget run in `check`, and the Node version matrix (18, 20, 22, current) stays. The 0.2.1 exports bug is exactly what these catch.
6. **Docs: "What oracular can and cannot learn."** Repeating outcomes (checkout, help read, stuck) learn per user; once-per-user outcomes (upgrade, cancel) rely on the priors and get only a decaying evidence gate. State the independence assumption (signals add; no sequence or interaction effects) and when it bites.

## Next: 0.4

The theme is **learning that matches how people behave**.

1. **Cross-episode attribution.** Yesterday's pricing visit gets no credit for today's upgrade, because attribution is per episode. Add an attribution window so signals from recent episodes can share credit, decayed by age. This is the single biggest limit on learning for days-scale intents. It interacts with hits and misses and with `resetOnOutcome` in non-obvious ways (does a past episode's miss get reversed when the outcome arrives later?), so the modelling note is written and discussed as a GitHub Discussion before any code.
2. **`npx oracular tune`.** From a recorder log across users, grouped by install id: base rate → prior, per-signal lift → initial weights, decay fit → half-life, spread → prior strength. Emits a ready-to-paste config with sample sizes and confidence per weight. Population-seeded config, per-user correction on device.
3. **Presets.** `presets.upgrade`, `presets.stuck`, `presets.churn`, `presets.willBuy`: plain config objects users can spread and override, with every knob explained. They are labelled as starting points and carry the sample size behind their numbers; two integrations is a thin base, and the label stays until it isn't.
4. **Small ergonomics.** `validateConfig()` exported on its own; a zero-cost `ms.days(7)` style units helper; a JSON Schema for the config.

## Before 1.0

The theme is **promises we can keep**. 1.0 means the API and the state format are commitments.

1. **Stability policy, written down.** What is public API (every export from `index.ts`, the serialized state shape, and the recorder format), the deprecation window (one minor with warnings before removal), the `STATE_VERSION` guarantee (every bump ships a migration and fixture tests, as 0.3 did), and that validation error types and message shapes are part of the contract.
2. **Property-based tests.** Purity, monotone decay, the α/β invariant, serialize/deserialize identity, and `shouldReveal ⇒ lower ≥ threshold`, generated rather than hand-picked. The fixtures and the deserialize fuzz from 0.3 keep running against every release in between.
3. **A debug overlay.** A small framework-free widget showing predict and explain live for every intent. The shadow panels the integrations built are the prototype.
4. **One public case study with real numbers**, produced by `replay` on a production shadow log, and at least two production users referenced.
5. **Housekeeping.** Pin GitHub Actions by SHA, add CodeQL and an OpenSSF Scorecard, document the publish-only-from-CI policy. Cheap, and done last so they never crowd out the items above.

## After 1.0

- **Framework bindings** (`@oracular/react`, `@oracular/vue`) only once a third integration shows what the common hook is. Note for whoever builds them: do not end episodes on background or `visibilitychange`; a short app switch is not a session boundary. Flush persistence and let `episodeTimeout` close idle episodes.
- **Persistence helpers** for localStorage, AsyncStorage and IndexedDB, as separate tiny packages, if integrations keep rewriting them.
- **Playground upgrade.** Paste a recorder log, scrub a timeline, drag sliders for weights, half-life and threshold, and watch p and the lower bound move.
- **Project structure.** A GitHub organization, a GOVERNANCE file and a second maintainer when a contributor shows up.

## Considered and declined, for now

- **A population benchmark against a logistic model on public clickstream data.** A model trained on data oracular refuses to collect will win on precision. The meaningful comparison is against the rules a team would otherwise hand-write, on their own shadow log, which `replay` provides.
- **Performance benchmarks.** `observe()` runs in microseconds. Bundle size is the number that matters, and `size-limit` guards it.
- **Anything that phones home**, including opt-in telemetry about the engine itself.

## How this changes

Open a [Discussion](https://github.com/Yuribenjamin/oracular/discussions) in the "Modelling" category with the integration you are doing and what the engine could not express. Items on this roadmap came from exactly that.
