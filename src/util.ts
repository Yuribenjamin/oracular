export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
