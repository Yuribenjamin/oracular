# Roadmap

Version 0.1 is the engine. These are planned, in no particular order, and deliberately left out of 0.1 so the core could ship small and settle:

- **React hook** (`useIntent`) packaged as a separate entry point, with persistence adapters.
- **Vue composable** with the same shape.
- **Devtools panel**: a richer version of the [Playground](/playground) that attaches to a live app's state and shows `explain` over time.
- **Presets**: starting configs for common intents (upgrade, churn, stuck, buy) with documented assumptions, to be tuned rather than written from scratch.

Not planned, by design: anything that performs I/O inside the library. Networking, storage and scheduling stay in the host app so that the privacy guarantee remains a property of the code rather than a promise.

## Proposing something

Open a [feature request](https://github.com/Yuribenjamin/oracular/issues/new?template=feature_request.yml) with the problem first and the proposal second, or start a thread in [Discussions](https://github.com/Yuribenjamin/oracular/discussions). Model changes need a test with concrete numbers and a matching update to the concept pages; see the [contributing guide](https://github.com/Yuribenjamin/oracular/blob/main/CONTRIBUTING.md).

## Changelog

Released changes are in the [Changelog](/changelog).
