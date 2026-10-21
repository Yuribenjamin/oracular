---
"@oracular/react": patch
---

**Hydration with a store that loaded first.** The hooks hydrated with the store's current state, so following the cold-start advice, `await store.load()` before the first screen renders, under server rendering made the client's first render disagree with the markup the server sent: React reported a hydration mismatch and rendered the tree again. `useIntent`'s `state`, `usePrediction` and `useIntentSelector` now hydrate with the fresh state the server rendered, `store.getInitialState()` (new: the state the store was created with, the same object for its life), and then show the loaded one; `usePrediction` is computed from that snapshot rather than read from the store, with the same re-rendering as before. The functions `useIntent` returns go to the current state, as documented, and belong in handlers in a server-rendered tree.

**An adapter that returns `undefined` counts as an empty key.** An adapter written in JavaScript that answered `undefined` instead of `null` for a missing key was treated as unreadable data: reported as `'parse'`, writes blocked until `clear()`. It is now an empty key, as the shipped adapters already report.
