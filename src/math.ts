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
 * Φ(−z) for z ≥ 0: the one-sided tail of the standard normal, so that `z` names the same level
 * under both bounds. Abramowitz–Stegun 7.1.26, |error| below 1.5e-7.
 */
export function normalTail(z: number): number {
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * poly * Math.exp(-x * x);
}

/** ln Γ(x) for x > 0: Stirling's series once x is shifted up to 8 or more (about 1e-11 relative). */
export function lgamma(x: number): number {
  let acc = 0;
  let v = x;
  while (v < 8) {
    acc -= Math.log(v);
    v += 1;
  }
  const r = 1 / v;
  const r2 = r * r;
  return (
    acc +
    (v - 0.5) * Math.log(v) -
    v +
    0.9189385332046728 +
    r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 / 1680)))
  );
}

/**
 * The continued fraction of the incomplete Beta function, by the modified Lentz method. Both
 * halves of each step share the denominator (a + i − 1)(a + i), so one loop over i covers them,
 * and i = 1 is the usual initialisation. Converges in about √max(a, b) steps; the cap covers the
 * largest counts a config allows.
 */
function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const guard = (v: number): number => (Math.abs(v) < tiny ? tiny : v);
  let c = 1 / tiny;
  let d = 1;
  let h = 1;
  for (let i = 1; i < 20_000; i++) {
    const m = i >> 1;
    const aa = ((i & 1 ? -(a + m) * (a + b + m) : m * (b - m)) * x) / ((a + i - 1) * (a + i));
    d = 1 / guard(1 + aa * d);
    c = guard(1 + aa / c);
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** The regularized incomplete Beta function I_x(a, b): P(X ≤ x) for X ~ Beta(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // The fraction converges fast on the near side of the mean; symmetry covers the far side.
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(x, a, b)) / a
    : 1 - (front * betacf(1 - x, b, a)) / b;
}

/**
 * The q-quantile of Beta(a, b), by bisection to a width of 1e-9. The answer is the middle of the
 * last bracket, so it is always strictly inside (0, 1), however small a or b.
 */
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, a, b) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The lower bound `shouldReveal` compares to the threshold: p − z·sd clamped to [0, 1], or
 * with `'exact'` the Beta quantile at the same one-sided level, Φ(−z).
 */
export function lowerBound(
  alpha: number,
  beta: number,
  z: number,
  bound: 'normal' | 'exact',
): number {
  if (bound === 'exact') return betaQuantile(normalTail(z), alpha, beta);
  return clamp01(betaMean(alpha, beta) - z * betaSd(alpha, beta));
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
