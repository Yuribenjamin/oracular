# Recipes

Five intents, each a config, the events to emit, and the reveal. The ad placement is one of these, not the point of the library. All durations are milliseconds.

```ts
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
```

## Onboarding tip when the user is stuck

Short half-life: being stuck is a state of the current session. A completed task is strong evidence against.

```ts
stuck: {
  prior: 0.1,
  priorStrength: 5,
  halfLife: 10 * MINUTE,
  signals: { 'editor.undo': 1, 'search.empty': 2, 'help.opened': 3, 'task.completed': -4 },
  outcome: 'help.article.read',
  reveal: { threshold: 0.6, cooldown: HOUR },
}
```

Emit `editor.undo`, `search.empty`, `help.opened`, `task.completed` from the UI; `help.article.read` when a help article is actually read. When `shouldReveal(state, 'stuck', now)` is true, show a contextual tip and call `markRevealed`. With `priorStrength: 5`, two empty searches and an undo (weight 5) already clear p = 0.5; the lower bound needs a little more.

## Upgrade offer

The [quickstart](/guide/quickstart). Signals that are followed by `upgrade.completed` grow heavier for this user, the ones that aren't shrink, and the outcome resets the slate and pauses offers for a week.

```ts
upgrade: {
  prior: 0.05,
  priorStrength: 10,
  halfLife: 7 * DAY,
  signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1, 'plan.downgraded': -4 },
  outcome: 'upgrade.completed',
}
```

## Churn save

Slow-building, costly to act on: a longer half-life, a stronger prior, and a stricter bound before offering a discount.

```ts
churn: {
  prior: 0.08,
  priorStrength: 20,
  halfLife: 14 * DAY,
  signals: {
    'session.short': 1,
    'notifications.disabled': 3,
    'export.all': 4,          // taking their data with them
    'feature.new.used': -2,
  },
  outcome: 'account.cancelled',
  reveal: { threshold: 0.5, z: 1.64, cooldown: 30 * DAY },
}
```

Emit `session.short` from your own session-length logic at `endEpisode` time. When the gate opens, reach out or offer a save; the outcome you hope never arrives still teaches the engine which signals mattered when it does.

## Feature discovery

Reveal advanced features to people who are ready for them. The outcome is the user adopting the feature on their own.

```ts
powerUser: {
  prior: 0.1,
  priorStrength: 10,
  halfLife: 3 * DAY,
  signals: {
    'command.palette.opened': 2,
    'shortcut.used': 2,
    'bulk.select': 3,
    'settings.advanced.opened': 2,
    'tour.dismissed': -1,
  },
  outcome: 'shortcuts.customized',
  reveal: { threshold: 0.6, cooldown: 14 * DAY },
}
```

When it fires, surface the keyboard-shortcut cheat sheet or the advanced panel once, and let `markRevealed` keep it quiet for two weeks.

## Ad placement

Show a sponsored placement to users who are likely to buy, and only then. A strong prior and a low base probability keep it quiet for browsers.

```ts
willBuy: {
  prior: 0.02,
  priorStrength: 50,
  halfLife: 3 * DAY,
  signals: { 'product.viewed': 1, 'cart.added': 3, 'wishlist.added': 2, 'cart.emptied': -3 },
  outcome: 'checkout.completed',
  reveal: { threshold: 0.4, z: 1.28, cooldown: DAY },
}
```

`shouldReveal(state, 'willBuy', now)` gates the placement; `markRevealed` after showing it. Because nothing leaves the device, the targeting decision is made entirely in the app, with no profile anywhere else.

## Putting several together

One state holds all intents. Emit events once; each intent takes what it declares. The same `cart.added` can be evidence for `willBuy` and against `churn`.

```ts
const config = { episodeTimeout: 30 * MINUTE, intents: { stuck, upgrade, churn, powerUser, willBuy } };
```

See [Using with frameworks](/guide/frameworks) for the load → observe → persist lifecycle around it.
