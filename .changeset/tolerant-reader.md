---
"oracular": patch
---

**Rollback.** `deserialize` reads a state one version newer than `STATE_VERSION` as the current one, ignoring the fields it does not know, so a rollback by one release keeps every user's history. The rule that allows it, a state version bump only adds fields, is now a commitment on the new stability page, together with what counts as public API, how versions are read before 1.0, the deprecation rule, the state-format guarantee, the 1.0 criteria and their status, and a 7 kB ceiling for the core. Two versions ahead still throws the `RangeError`, and `migrate` is still consulted for it. From now on the changeset of every state version bump says what an older reader silently loses; this release bumps nothing, so a 0.6 reader loses nothing but was never able to read ahead.
