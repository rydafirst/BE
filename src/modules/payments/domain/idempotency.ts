/**
 * Idempotency for money operations. A second attempt with the same key must be a no-op
 * that returns the first result (07-engineering-standards §2.3).
 */
export interface IdempotencyRecord<T = unknown> {
  key: string;
  result: T;
}

export type IdempotencyDecision<T> =
  | { action: 'return_cached'; result: T }
  | { action: 'proceed' };

export function decideIdempotency<T>(existing: IdempotencyRecord<T> | null): IdempotencyDecision<T> {
  if (existing) return { action: 'return_cached', result: existing.result };
  return { action: 'proceed' };
}

/** Deterministic, collision-resistant key for a money operation on a job. */
export function opKey(operation: 'hold' | 'settle' | 'payout', jobId: string, discriminator = 'v1'): string {
  return `${operation}:${jobId}:${discriminator}`;
}
