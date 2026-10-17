export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property check, so event names like "constructor" never hit Object.prototype. */
export function hasOwn(record: object, key: string): boolean {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; this library targets ES2020 runtimes.
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function getOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return hasOwn(record, key) ? record[key] : undefined;
}

export function mapRecord<T, U>(
  record: Record<string, T>,
  fn: (value: T, key: string) => U,
): Record<string, U> {
  const out: Record<string, U> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = fn(value, key);
  }
  return out;
}
