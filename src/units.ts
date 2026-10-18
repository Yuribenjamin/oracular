/** The units of {@link ms}: each takes a count and returns milliseconds. */
export interface Units {
  /** `n` seconds in milliseconds: `n × 1000`. */
  readonly seconds: (n: number) => number;
  /** `n` minutes in milliseconds: `n × 60 000`. */
  readonly minutes: (n: number) => number;
  /** `n` hours in milliseconds: `n × 3 600 000`. */
  readonly hours: (n: number) => number;
  /** `n` days in milliseconds: `n × 86 400 000`. */
  readonly days: (n: number) => number;
  /** `n` weeks in milliseconds: `n × 604 800 000`. */
  readonly weeks: (n: number) => number;
}

/**
 * Durations in milliseconds, the unit of `Date.now()`: `ms.days(7)` is `604800000`. Plain
 * multiplications and nothing else, for `halfLife`, `cooldown`, `episodeTimeout` and
 * `learning.halfLife` when your timestamps are in milliseconds. If your `at` is in another unit,
 * write durations in that unit instead: the engine only needs the two to agree.
 *
 * @example
 * ```ts
 * const config = {
 *   episodeTimeout: ms.minutes(30),
 *   intents: {
 *     upgrade: {
 *       prior: 0.05,
 *       priorStrength: 10,
 *       halfLife: ms.days(7),
 *       signals: { 'pricing.viewed': 3 },
 *       reveal: { cooldown: ms.weeks(2) },
 *     },
 *   },
 * };
 * ```
 */
export const ms: Units = {
  seconds: (n) => n * 1_000,
  minutes: (n) => n * 60_000,
  hours: (n) => n * 3_600_000,
  days: (n) => n * 86_400_000,
  weeks: (n) => n * 604_800_000,
};
