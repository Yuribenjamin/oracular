# Presets

Four intents you can start from without writing a number: `willBuy`, `upgrade`, `stuck` and `churn`, as plain config objects from `oracular/presets`. Spread one into your config, rename its events to yours, override what you know better. Every knob is explained in the source, and every preset says where its numbers come from.

```ts
import { createState } from 'oracular';
import { presets } from 'oracular/presets';

const state = createState({
  episodeTimeout: 30 * 60 * 1000,
  intents: {
    buy: {
      ...presets.willBuy,
      outcome: 'order.placed', // your event names
      signals: { ...presets.willBuy.signals, 'wishlist.added': 2 }, // and your extra signals
    },
  },
});
```

## What is in the box

<!-- generated:presets-table -->
| preset | prior | strength | half-life | signals | outcome | reveal | numbers |
| ------ | ----- | -------- | --------- | ------- | ------- | ------ | ------- |
| `willBuy` | 0.048 | 4 | 1 hour | `cart.added` 2.3 | `checkout.completed` | cooldown 1 day | tuned: 181,055 sessions, 93,537 visitors |
| `upgrade` | 0.05 | 10 | 7 days | `pricing.viewed` 3, `limit.hit` 2, `export.clicked` 1 | `upgrade.completed` | defaults | hand-written |
| `stuck` | 0.1 | 5 | 10 minutes | `editor.undo` 1, `search.empty` 2, `help.opened` 3, `task.completed` -4 | `help.article.read` | threshold 0.6, cooldown 1 hour, saturate off | hand-written |
| `churn` | 0.08 | 20 | 14 days | `session.short` 1, `notifications.disabled` 3, `export.all` 4, `feature.new.used` -2 | `account.cancelled` | threshold 0.5, z 1.64 | hand-written |
<!-- /generated:presets-table -->

The four objects are frozen, through and through: spread one into your own config to change a value, as the examples do, rather than assigning into it.

Durations are milliseconds. `presetSources` carries the same provenance as data:

```ts
import { presetSources } from 'oracular/presets';
presetSources.willBuy.kind; // 'tuned'
presetSources.upgrade.kind; // 'hand-written'
```

## Read the label

- **`willBuy` is tuned.** Its numbers are what `oracular tune` fitted on a public clickstream of 2.7 million events: 181,055 sessions from 93,537 visitors, 8,628 of them ending with an order ([the case study](/guide/case-study-clickstream)). The prior is the share of sessions that end with an order, the strength how fast one visitor's own history should take over, the weight of `cart.added` its measured lift, and the half-life the best point of the grid. There is no weight for viewing a product, because on that data a view is in 99% of sessions and says nothing about buying; add one only if your data says otherwise. One shop, one summer, a 4.8% session conversion: a measured starting point, not a universal number. A shop converting at 1% has a different prior and most likely a different weight, and should still run `tune`.
- **`upgrade`, `stuck` and `churn` are hand-written.** They are the configs the documentation uses as running examples, with the reasoning the tuning guide gives, and nobody has measured them against a log. They encode what a careful person would write before seeing data, which is still better than a blank page, and the engine corrects them per user from the first episodes on.

Either way the path is the same: start from the preset, run in [shadow mode](/guide/shadow-mode), let `tune` replace the guesses with your population's numbers, ship that.

## Renaming events

A preset names its events the way the documentation does (`cart.added`, `pricing.viewed`, `help.article.read`). Your app has its own names. Spread the preset and replace `signals` and `outcome`, keeping the weights:

```ts
const stuck = {
  ...presets.stuck,
  signals: { 'doc.undo': 1, 'search.no_results': 2, 'help.panel.opened': 3, 'task.done': -4 },
  outcome: 'help.article.opened',
};
```

The weights are the knowledge; the names are yours.

## Reference

- [`src/presets.ts`](https://github.com/Yuribenjamin/oracular/blob/main/src/presets.ts) is the whole subpath, with every knob explained in its comments. The types [`PresetName`](/api/type-aliases/PresetName) and [`PresetSource`](/api/interfaces/PresetSource) are in the API reference, as is [`IntentConfig`](/api/interfaces/IntentConfig). See also the [Tuning guide](/guide/tuning).
