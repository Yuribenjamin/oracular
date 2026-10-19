/**
 * A virtual clock for recordings, created only when the page URL carries `?demo`. The store then
 * stamps every event and read with this clock instead of `Date.now`, persists nothing, and the
 * page exposes the clock as `window.oracularDemo`, so that `scripts/record-inspector.mjs` at the
 * repository root can step time, set a caption and take the same frames on every run. Without the
 * query parameter none of this is created, and the production build behaves as before.
 */
export interface DemoClock {
  /** The current virtual time. Starts on Monday 5 January 2026, 09:00 UTC. */
  now(): number;
  /** Moves the clock forward and re-renders the app, so reads at `now` follow it. */
  advance(ms: number): void;
  /** Sets the caption shown above the page and re-renders. */
  say(text: string): void;
  /** The current caption. */
  caption(): string;
  /** Called after every `advance` and `say`; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const DEMO_START = Date.UTC(2026, 0, 5, 9, 0, 0);

export function createDemoClock(): DemoClock {
  let at = DEMO_START;
  let text = '';
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    now: () => at,
    advance(ms) {
      at += ms;
      notify();
    },
    say(next) {
      text = next;
      notify();
    },
    caption: () => text,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The demo clock when the URL says `?demo`, otherwise null. */
export function demoFromUrl(): DemoClock | null {
  return new URLSearchParams(window.location.search).has('demo') ? createDemoClock() : null;
}

declare global {
  interface Window {
    oracularDemo?: DemoClock;
  }
}
