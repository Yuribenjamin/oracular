---
"oracular": minor
---

**Six lift measures are deprecated.** 0.9 added `learning.lift` with seven association measures. A sweep of all seven on the clickstream case study found none that beats the default, `'normalized-difference'`, on either split, and 1.0 commits every value in the schema for the whole of 1.x. So `'absolute-difference'`, `'relative-lift'`, `'risk-ratio'`, `'log-lift'`, `'odds-ratio'` and `'association-rule'` are marked `@deprecated` in `LiftType`, named in the JSON Schema's description, and removed in 1.0. Nothing changes in this release: every value keeps working exactly as it did, a config that sets one keeps loading, and the type checker shows the mark. `learning.lift` itself stays, accepting the default, so that a measure can come back as a minor when a real integration shows it should.
