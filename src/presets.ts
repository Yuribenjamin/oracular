import type { IntentConfig, PresetName, PresetSource } from './types';
import { ms } from './units';

export type { PresetName, PresetSource } from './types';

/**
 * A visitor about to buy. Tuned on a public e-commerce clickstream of 2.7 million events (see the
 * case study in the guide): one shop, one summer (May to September 2015), 181,080 sessions from
 * 93,537 visitors, 8,628 of them ending with an order, a session conversion of 4.8%; scored on as
 * many visitors the fit never saw. A measured starting point, not a universal number: a shop that
 * converts 1% or 20% of its sessions has a different prior and most likely a different weight.
 * Start here, run in shadow mode, and let `tune` replace these with your own numbers.
 *
 * - `prior` 0.048: the share of sessions that end with an order (fitted 0.0477).
 * - `priorStrength` 4: visitors differ a lot in how often they buy, so one visitor's own history
 *   should outweigh the population after a handful of sessions.
 * - `halfLife` one hour: the best point of the grid; buying intent within a visit is a matter of
 *   minutes, and tomorrow's visit starts over.
 * - `cart.added` 2.3: its measured lift (fitted 2.32). 58% of sessions with a cart add end with an
 *   order, against 0.8% of those without. There is no weight for viewing a product: on that data a
 *   view is in 99% of sessions and says nothing about buying. Add one only if your data disagrees.
 * - `cooldown` one day: after an order, or after acting on the intent, stay quiet for a day; the
 *   half-life would otherwise make the default cooldown an hour.
 *
 * Rename `cart.added` and `checkout.completed` to your events by spreading.
 */
const willBuy: IntentConfig = {
  prior: 0.048,
  priorStrength: 4,
  halfLife: ms.hours(1),
  signals: { 'cart.added': 2.3 },
  outcome: 'checkout.completed',
  reveal: { cooldown: ms.days(1) },
};

/**
 * A user about to upgrade: the quickstart config, hand-written. Interest in a paid plan builds over
 * days, so the half-life is a week; the prior is a guess at the share of users who upgrade in a
 * week; `priorStrength` 10 means about six full-weight signals across sessions open the default
 * gate; the weights rank the signals by how directly they point at paying. Nobody has measured
 * these against a log.
 */
const upgrade: IntentConfig = {
  prior: 0.05,
  priorStrength: 10,
  halfLife: ms.days(7),
  signals: { 'pricing.viewed': 3, 'limit.hit': 2, 'export.clicked': 1 },
  outcome: 'upgrade.completed',
};

/**
 * A user stuck on a task, hand-written. Being stuck is a state of the current session, so the
 * half-life is ten minutes and the cooldown an hour; `saturate: false` because here repetition is
 * the evidence (the fifth undo in a row says more than the first); `task.completed` is strong
 * evidence against; the gate is raised to 0.6 because an unwanted tip is an interruption. Nobody
 * has measured these against a log.
 */
const stuck: IntentConfig = {
  prior: 0.1,
  priorStrength: 5,
  halfLife: ms.minutes(10),
  signals: { 'editor.undo': 1, 'search.empty': 2, 'help.opened': 3, 'task.completed': -4 },
  outcome: 'help.article.read',
  saturate: false,
  reveal: { threshold: 0.6, cooldown: ms.hours(1) },
};

/**
 * A user about to leave, hand-written. Churn builds over weeks, so the half-life is two weeks and
 * the prior strength 20: it should take a lot to call someone a churn risk. Exporting all their
 * data is the strongest signal; using a new feature counts against. `z` 1.64 asks for a one-sided
 * 95% bound before a save offer, because a discount has a real cost. Nobody has measured these
 * against a log.
 */
const churn: IntentConfig = {
  prior: 0.08,
  priorStrength: 20,
  halfLife: ms.days(14),
  signals: {
    'session.short': 1,
    'notifications.disabled': 3,
    'export.all': 4,
    'feature.new.used': -2,
  },
  outcome: 'account.cancelled',
  reveal: { threshold: 0.5, z: 1.64 },
};

/**
 * Starting points for four common intents, as plain config objects. Spread one into your config,
 * rename its events to yours, override what you know better; see {@link presetSources} for where
 * each preset's numbers come from.
 *
 * @example
 * ```ts
 * import { presets } from 'oracular/presets';
 *
 * const config = {
 *   episodeTimeout: 30 * 60 * 1000,
 *   intents: {
 *     buy: { ...presets.willBuy, outcome: 'order.placed' },
 *   },
 * };
 * ```
 */
export const presets: Readonly<Record<PresetName, IntentConfig>> = {
  willBuy,
  upgrade,
  stuck,
  churn,
};

/**
 * Where each preset's numbers come from. Read it before trusting a preset: a tuned one carries its
 * sample size, a hand-written one carries nothing but reasoning.
 *
 * @example
 * ```ts
 * import { presetSources } from 'oracular/presets';
 * presetSources.willBuy.kind; // 'tuned'
 * ```
 */
export const presetSources: Readonly<Record<PresetName, PresetSource>> = {
  willBuy: {
    kind: 'tuned',
    note: 'oracular tune on a public e-commerce clickstream: one shop, May to September 2015, 2.7 million events, 4.8% of sessions ending with an order; fitted October 2026, the fitted 0.0477 and 2.32 rounded',
    episodes: 181_080,
    installs: 93_537,
  },
  upgrade: {
    kind: 'hand-written',
    note: 'the quickstart config from the documentation; no log behind it',
    episodes: null,
    installs: null,
  },
  stuck: {
    kind: 'hand-written',
    note: 'the onboarding-tip example from the documentation; no log behind it',
    episodes: null,
    installs: null,
  },
  churn: {
    kind: 'hand-written',
    note: 'the churn-save example from the documentation; no log behind it',
    episodes: null,
    installs: null,
  },
};
