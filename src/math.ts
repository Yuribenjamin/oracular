/** 2^(−elapsed / halfLife). Returns 1 for zero, negative or non-finite elapsed time. */
export function decayFactor(elapsed: number, halfLife: number): number {
  if (!(elapsed > 0) || !Number.isFinite(elapsed)) return 1;
  return 2 ** (-elapsed / halfLife);
}

export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function betaVariance(alpha: number, beta: number): number {
  const n = alpha + beta;
  return (alpha * beta) / (n * n * (n + 1));
}

export function betaSd(alpha: number, beta: number): number {
  return Math.sqrt(betaVariance(alpha, beta));
}

export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * What the n-th occurrence of a signal within one episode adds, as a fraction of its weight:
 * log2(1 + 1/n), so that n occurrences add log2(1 + n) weights in total. 1 for the first
 * occurrence, 0.585 for the second, 0.415 for the third; every doubling adds one more weight.
 */
export function repeatFactor(n: number): number {
  return Math.log1p(1 / n) / Math.LN2;
}

/** Laplace-smoothed rate: (successes + 1) / (total + 2). Always strictly inside (0, 1). */
export function laplace(successes: number, total: number): number {
  return (successes + 1) / (total + 2);
}

/**
 * How far a rate `q` sits from a base rate `b`, scaled to [−1, 1]:
 * +1 when q is 1, 0 when q equals b, −1 when q is 0.
 */
export function lift(q: number, b: number): number {
  if (q >= b) return b >= 1 ? 0 : (q - b) / (1 - b);
  return b <= 0 ? 0 : (q - b) / b;
}
