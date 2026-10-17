import { expect } from 'vitest';
import { priorCounts } from '../src/intent';
import type { EngineConfig, EngineState } from '../src/types';
import { STATE_VERSION } from '../src/version';

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Recursively freezes a value so any mutation throws (tests run in strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectFinite(value: unknown, label: string): void {
  expect(
    typeof value === 'number' && Number.isFinite(value),
    `${label} must be finite, got ${String(value)}`,
  ).toBe(true);
}

function expectNullOrFinite(value: unknown, label: string): void {
  if (value !== null) expectFinite(value, label);
}

/**
 * The state's structural guarantees. Every test calls this after every operation.
 * If it fails, the engine has a bug; the test is not the thing to loosen.
 */
export function assertInvariants(state: EngineState): void {
  expect(state.version).toBe(STATE_VERSION);

  const declaredIntents = Object.keys(state.config.intents);
  for (const name of Object.keys(state.intents)) {
    expect(declaredIntents, `undeclared intent ${name} in state.intents`).toContain(name);
  }
  for (const name of Object.keys(state.episode.intents)) {
    expect(declaredIntents, `undeclared intent ${name} in state.episode.intents`).toContain(name);
  }
  expectNullOrFinite(state.episode.startedAt, 'episode.startedAt');
  expectNullOrFinite(state.episode.lastEventAt, 'episode.lastEventAt');

  for (const [name, intent] of Object.entries(state.config.intents)) {
    const is = state.intents[name];
    expect(is, `missing state for intent ${name}`).toBeDefined();
    if (is === undefined) continue;

    const signals = Object.keys(intent.signals);
    const { alpha0, beta0 } = priorCounts(intent);

    let sumAlpha = 0;
    let sumBeta = 0;
    for (const [signal, c] of Object.entries(is.contributions)) {
      expect(signals, `undeclared signal ${signal} in ${name}.contributions`).toContain(signal);
      expectFinite(c.alpha, `${name}.contributions.${signal}.alpha`);
      expectFinite(c.beta, `${name}.contributions.${signal}.beta`);
      expect(c.alpha).toBeGreaterThanOrEqual(0);
      expect(c.beta).toBeGreaterThanOrEqual(0);
      sumAlpha += c.alpha;
      sumBeta += c.beta;
    }
    expectFinite(is.alpha, `${name}.alpha`);
    expectFinite(is.beta, `${name}.beta`);
    expect(
      Math.abs(is.alpha - (alpha0 + sumAlpha)),
      `${name}: alpha != alpha0 + Σ contributions`,
    ).toBeLessThanOrEqual(1e-9);
    expect(
      Math.abs(is.beta - (beta0 + sumBeta)),
      `${name}: beta != beta0 + Σ contributions`,
    ).toBeLessThanOrEqual(1e-9);
    expect(is.alpha).toBeGreaterThan(0);
    expect(is.beta).toBeGreaterThan(0);

    const p = is.alpha / (is.alpha + is.beta);
    expectFinite(p, `${name}: p`);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);

    for (const [signal, rec] of Object.entries(is.learned)) {
      expect(signals, `undeclared signal ${signal} in ${name}.learned`).toContain(signal);
      expectFinite(rec.hits, `${name}.learned.${signal}.hits`);
      expectFinite(rec.misses, `${name}.learned.${signal}.misses`);
      expect(rec.hits).toBeGreaterThanOrEqual(0);
      expect(rec.misses).toBeGreaterThanOrEqual(0);
    }
    expectFinite(is.episodes.hits, `${name}.episodes.hits`);
    expectFinite(is.episodes.misses, `${name}.episodes.misses`);
    expect(is.episodes.hits).toBeGreaterThanOrEqual(0);
    expect(is.episodes.misses).toBeGreaterThanOrEqual(0);

    expectNullOrFinite(is.updatedAt, `${name}.updatedAt`);
    expectNullOrFinite(is.learnedAt, `${name}.learnedAt`);
    expectNullOrFinite(is.lastRevealedAt, `${name}.lastRevealedAt`);
    expect(Number.isInteger(is.revealCount) && is.revealCount >= 0, `${name}.revealCount`).toBe(
      true,
    );

    const episode = state.episode.intents[name];
    if (episode !== undefined) {
      expect(new Set(episode.seen).size, `${name}: duplicate signals in episode.seen`).toBe(
        episode.seen.length,
      );
      for (const signal of episode.seen) {
        expect(signals, `undeclared signal ${signal} in ${name} episode.seen`).toContain(signal);
      }
      expect(typeof episode.resolved).toBe('boolean');
    }
  }

  // Plain JSON: no undefined, NaN, Infinity, functions or class instances anywhere.
  expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
}

/** A SaaS-style fixture used across the suite. Durations in ms. */
export function upgradeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    intents: {
      upgrade: {
        prior: 0.05,
        priorStrength: 10,
        halfLife: 7 * DAY,
        signals: {
          'pricing.viewed': 3,
          'limit.hit': 2,
          'export.clicked': 1,
          'plan.downgraded': -4,
        },
        outcome: 'upgrade.completed',
      },
    },
    ...overrides,
  };
}
