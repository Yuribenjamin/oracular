---
"@oracular/react": patch
---

**A parse failure is reported once and stops the re-reads.** Stored data that `deserialize` rejects blocked writes, as it should, but every debounced save then read it again, parsed it again and reported `'parse'` again, for data that cannot parse any better the second time. Saves after a parse failure now read and write nothing; `load()` reads again and reports only when the stored data changed, and `clear()` starts over, which is the handling to pass: `onError: (error, phase) => { if (phase === 'parse') void store.clear(); }`. A read that throws is still retried by every save, since the next attempt may succeed.

**An empty key counts as saved.** A store that found nothing stored wrote a fresh state on the first flush or unmount even when nothing had been tracked, and so did a store after `clear()`. An empty key holds what a fresh state holds, so those writes are gone; the first event writes as before.

**Cold start, in the docs.** Before the read settles, `reveal` decides on the state in memory, not on the stored history. The README and the guide now say to `await store.load()` before the first screen renders where a nudge there must respect a stored cooldown.
