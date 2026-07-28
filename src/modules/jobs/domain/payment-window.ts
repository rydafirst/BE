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

/**
 * Pure rule: a customer may (re-)pay an order ONLY while it is still CREATED — i.e. unfunded on our
 * side. Once it is FUNDED or beyond, re-issuing a checkout would risk a second charge, so we refuse.
 * The service checks this AFTER expiring stale orders, so an order past the window reads as CANCELLED
 * (not CREATED) and is refused too. This is the double-charge guard for the "re-pay without restarting
 * the trip" flow.
 */
export function canRetryPayment(status: JobStatus): boolean {
  return status === 'CREATED';
}
