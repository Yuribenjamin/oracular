---
"oracular": minor
---

**Inspect.** `inspect(state, at, opts?)` in the main entry returns every intent's prediction, gate and explanation as one object, in config order. `oracular/inspect` renders that snapshot: `renderInspector` as an HTML fragment with inline styles and every string escaped, `mountInspector` into anything with an `innerHTML`, with `update` and `unmount`; neither touches a DOM API or sets a timer, and neither carries engine code. The subpath is experimental, as the stability page says: its markup and options may change in a minor. The types `Snapshot` and `IntentSnapshot` are exported from the main entry.
