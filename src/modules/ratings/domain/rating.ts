// Pure rating rules — no I/O. A customer rates the rider 1–5 after a completed delivery.

export function isValidStars(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Average (rounded to 1dp) + count over a rider's ratings. Empty set → 0/0. */
export function averageRating(stars: readonly number[]): { average: number; count: number } {
  if (stars.length === 0) return { average: 0, count: 0 };
  const sum = stars.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / stars.length) * 10) / 10, count: stars.length };
}

/** Trim + cap an optional comment; empty becomes undefined. */
export function cleanComment(raw?: string): string | undefined {
  const c = (raw ?? '').trim().slice(0, 500);
  return c.length ? c : undefined;
}
