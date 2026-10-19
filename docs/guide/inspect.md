# Inspect: see `explain` live

::: warning Experimental
`oracular/inspect` may change its markup, styles and options in a minor release; see [Stability and 1.0](/guide/stability#what-is-public-api). `inspect` itself, in the main entry, is stable API.
:::

Everything the engine would tell you about every intent at one moment, as one object, and a panel that renders it. `inspect` lives in the main entry and is pure; the renderer and the mount helper live in `oracular/inspect`, touch no DOM API and set no timer, so they run wherever the engine runs and cost the production bundle nothing when you leave them out.

## The snapshot

```ts
import { inspect } from 'oracular';

const snapshot = inspect(state, Date.now());
// { at, intents: [{ intent, prediction, reveal, explanation }, …] } in config order
console.table(snapshot.intents.map((i) => ({ intent: i.intent, p: i.prediction.p, reveal: i.reveal })));
```

Each entry is exactly what [`evaluate`](/api/functions/evaluate) returns for that intent: the [`Prediction`](/api/interfaces/Prediction), whether `shouldReveal` would fire, and the [`explain`](/guide/explainability) rows. The same reveal overrides and explain filters apply to every intent: `inspect(state, now, { nonZero: true, limit: 3 })`.

## The panel

```ts
import { inspect } from 'oracular';
import { mountInspector } from 'oracular/inspect';

const panel = mountInspector(document.querySelector('#oracular')!, () => inspect(state, Date.now()));

function onEvent(event) {
  state = observe(state, event);
  panel.update(); // or setInterval(panel.update, 500) while you develop
}
```

`mountInspector` writes an HTML fragment into the container's `innerHTML` and gives you `update` and `unmount`. The fragment is one block per intent: `p`, the lower bound, the standard deviation, the evidence, and the gate's state (reveal, suppressed until when, or neither), then a table with one row per declared signal: the contribution it holds right now, its impact on `p`, the initial, learned and effective weights, and its hit/miss record. Signals holding nothing are greyed. Styles are inline, there is no script, and every string that came from your app is escaped.

`renderInspector(snapshot, { title, digits })` is the same fragment as a string, for a devtools pane of your own, a test, or a file:

```ts
import { renderInspector } from 'oracular/inspect';
writeFileSync('oracular.html', renderInspector(inspect(state, Date.now()), { title: 'checkout flow' }));
```

## What it is for

- **Development.** Keep the panel open while you click through your app and watch which signal moves `p`, whether the gate opens, and why it does not: a lower bound still short of the threshold, or a cooldown.
- **Shadow mode.** The integrations that ran oracular silently built a panel like this to read `explain` during the shadow period; this is that panel, framework-free.
- **Tests.** `inspect` is plain data: assert on it instead of calling `predict`, `shouldReveal` and `explain` three times.

The [Playground](/playground) runs the same engine in your browser with the same tables, for configs you want to try without an app.

## Reference

- [`inspect`](/api/functions/inspect), [`Snapshot`](/api/interfaces/Snapshot), [`IntentSnapshot`](/api/interfaces/IntentSnapshot), [`evaluate`](/api/functions/evaluate), [`explain`](/api/functions/explain); `renderInspector` and `mountInspector` in [`src/inspect.ts`](https://github.com/Yuribenjamin/oracular/blob/main/src/inspect.ts).
