import type { PersistAdapter } from '../src';

export const T = 1_700_000_000_000;

export function clock(start = T) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Lets the promise chains the store builds settle without advancing any timer. */
export async function microtasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** A synchronous adapter that records every write and read; `remove` only when asked for. */
export function fakeAdapter(initial: string | null = null, withRemove = false) {
  const writes: string[] = [];
  let stored = initial;
  let reads = 0;
  let removes = 0;
  const adapter: PersistAdapter = {
    load: () => {
      reads++;
      return stored;
    },
    save: (json) => {
      stored = json;
      writes.push(json);
    },
  };
  if (withRemove) {
    adapter.remove = () => {
      removes++;
      stored = null;
    };
  }
  return { adapter, writes, stored: () => stored, reads: () => reads, removes: () => removes };
}

/** An adapter whose reads the test settles by hand; writes are synchronous and recorded. */
export function deferredAdapter(initial: string | null = null) {
  const writes: string[] = [];
  let stored = initial;
  let reads = 0;
  const pending: { resolve: (json: string | null) => void; reject: (error: unknown) => void }[] =
    [];
  const adapter: PersistAdapter = {
    load: () => {
      reads++;
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    save: (json) => {
      stored = json;
      writes.push(json);
    },
  };
  const next = () => {
    const read = pending.shift();
    if (read === undefined) throw new Error('no read is pending');
    return read;
  };
  return {
    adapter,
    writes,
    stored: () => stored,
    reads: () => reads,
    /** Settles the oldest pending read with what the storage holds now. */
    resolveLoad: () => next().resolve(stored),
    rejectLoad: (error: unknown) => next().reject(error),
  };
}

/** An adapter whose writes the test settles by hand, so their order and timing are its own. */
export function slowSaveAdapter(initial: string | null = null) {
  const pending: { json: string; resolve: () => void }[] = [];
  const landed: string[] = [];
  let stored = initial;
  const adapter: PersistAdapter = {
    load: () => stored,
    save: (json) =>
      new Promise<void>((resolve) => {
        pending.push({ json, resolve });
      }),
  };
  return {
    adapter,
    pending,
    landed,
    stored: () => stored,
    /** Lands the oldest pending write. */
    settle: () => {
      const write = pending.shift();
      if (write === undefined) throw new Error('no write is pending');
      stored = write.json;
      landed.push(write.json);
      write.resolve();
    },
  };
}
