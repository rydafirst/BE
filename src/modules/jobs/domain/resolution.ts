import { GRACE_SECONDS, waitingFee } from '../../confirmations/domain/fallback.js';

/**
 * Economics for the "recipient unavailable" resolution (product rule: the customer is only ever
 * refunded when the RIDER fails; a missing recipient is not the rider's fault).
 *
 * Two sender-paid, on-top charges live here — neither is ever carved out of the rider's fare:
 *   1. WAITING  — the first 10 minutes are FREE grace; only time beyond grace is metered
 *                 (₦50/min, capped ₦1,000). The sender must approve the wait before it accrues.
 *   2. RETURN   — a separate leg back to the sender, priced at 75% of the original fare
 *                 ("half + a quarter": above half, but a reduced price for the customer since it
 *                 scales with the original distance).
 */

/** Return leg is 75% of the original fare — reduced, but distance-aware (scales off the original). */
export const RETURN_FARE_PCT = 75;

/** Price of the return leg in minor units, derived from the original total the customer paid. */
export function computeReturnFareMinor(originalTotalMinor: number): number {
  if (!Number.isInteger(originalTotalMinor) || originalTotalMinor < 0) {
    throw new Error('originalTotalMinor must be a non-negative integer');
  }
  return Math.round((originalTotalMinor * RETURN_FARE_PCT) / 100);
}

/**
 * Waiting owed by the sender for a wait that started at `waitStartedAtMs`. The 10-min grace is free;
 * only whole minutes beyond the grace are charged, capped. Returns integer minor units.
 * A wait that never passed the grace window costs nothing.
 */
export function accruedWaitingMinor(waitStartedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(waitStartedAtMs) || !Number.isFinite(nowMs)) {
    throw new Error('waitStartedAtMs and nowMs must be finite');
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - waitStartedAtMs) / 1000));
  return waitingFee(elapsedSeconds).amount;
}

/** True once the free grace has elapsed and metered charging is allowed to begin. */
export function graceElapsed(waitStartedAtMs: number, nowMs: number): boolean {
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - waitStartedAtMs) / 1000));
  return elapsedSeconds >= GRACE_SECONDS;
}
