import type { EngineState } from 'oracular';

export type ClockStatus = 'steady' | 'held' | 'custom';

export interface HistoryClock {
  now(): number;
  /** Capture elapsed time now; resolve it against restored history when the operation replays. */
  capture(): () => number;
  restore(state: EngineState): void;
  status(): ClockStatus;
}

/** Latest history anchor, including episode closes that do not advance the event clock. */
function latest(state: EngineState): number | null {
  let at = state.clock.at;
  for (const intent of Object.values(state.intents)) {
    for (const value of [
      intent.updatedAt,
      intent.learnedAt,
      ...intent.pending.map((p) => p.endedAt),
    ]) {
      if (value !== null && (at === null || value > at)) at = value;
    }
  }
  return at;
}

export function historyClock(
  custom: (() => number) | undefined,
  monotonic: (() => number) | undefined,
  maxResumeGap: number,
): HistoryClock {
  if (!Number.isFinite(maxResumeGap) || maxResumeGap < 0) {
    throw new RangeError('@oracular/react: maxResumeGap must be a finite nonnegative duration');
  }
  if (custom !== undefined) {
    return {
      now: custom,
      capture: () => {
        const at = custom();
        return () => at;
      },
      restore: () => {},
      status: () => 'custom',
    };
  }
  const wall = Date.now();
  const timer = monotonic ?? globalThis.performance?.now.bind(globalThis.performance);
  const read = (): number => {
    try {
      return timer?.() ?? Number.NaN;
    } catch {
      return Number.NaN;
    }
  };
  const origin = read();
  let status: ClockStatus = Number.isFinite(wall) && Number.isFinite(origin) ? 'steady' : 'held';
  let base = Number.isFinite(wall) ? wall : 0;
  let elapsed = 0;
  const tick = (): number => {
    const next = read() - origin;
    if (Number.isFinite(next) && next >= elapsed) elapsed = next;
    else status = 'held';
    return elapsed;
  };
  return {
    now: () => base + tick(),
    capture: () => {
      const stamp = tick();
      return () => base + stamp;
    },
    status: () => status,
    restore: (state) => {
      const at = latest(state);
      if (at === null) return;
      const gap = wall - at;
      if (status === 'steady' && gap >= 0 && gap <= maxResumeGap) base = wall;
      else {
        base = at;
        status = 'held';
      }
    },
  };
}
