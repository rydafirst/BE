import type { JobStatus } from './job-state-machine.js';

/**
 * Pure rule: an order is "expired" once it has sat unpaid (still CREATED) past the payment
 * window. No funds are captured on a CREATED order, so expiry simply cancels it. Kept pure and
 * side-effect free (like cancellation.ts / fallback.ts) so it's deterministic and unit-testable;
 * the service only orchestrates the resulting state transition.
 */
export function isPaymentExpired(
  status: JobStatus,
  createdAtMs: number,
  nowMs: number,
  windowMs: number,
): boolean {
  return status === 'CREATED' && nowMs - createdAtMs > windowMs;
}
