import { waitingFee } from '../../confirmations/domain/fallback.js';

/** Base compensation for the wasted trip when a receiver is unavailable (₦500). */
export const BASE_FAILED_ATTEMPT_FEE_MINOR = 50_000;

export type FallbackPolicy = 'WAIT' | 'DELEGATE' | 'RETURN';

export interface FailedAttemptFeeInput {
  collectedMinor: number;          // exact amount held in escrow (hard cap on any payout)
  policy?: FallbackPolicy;         // customer's "receiver unavailable" choice
  arrivedAtMs?: number;            // when the rider was GPS-verified at the drop-off
  nowMs: number;
}

export interface FailedAttemptFee {
  totalMinor: number;   // total owed to the rider (base + metered waiting), capped at collected
  baseMinor: number;    // base attempt fee actually applied (capped)
  waitingMinor: number; // waiting portion actually applied (fills up to collected, never negative)
}

/**
 * Pure settlement math for a failed delivery attempt.
 * - Base attempt fee always applies.
 * - The metered waiting fee applies ONLY for the WAIT policy once the rider has arrived
 *   (10-min grace, then ₦50/min, capped) — computed by the tested `waitingFee` function.
 * INVARIANT: total is capped at `collectedMinor`, so a job can never disburse more than collected.
 */
export function failedAttemptFee(input: FailedAttemptFeeInput): FailedAttemptFee {
  let waitingRaw = 0;
  if (input.policy === 'WAIT' && input.arrivedAtMs !== undefined) {
    const elapsedSeconds = Math.max(0, Math.floor((input.nowMs - input.arrivedAtMs) / 1000));
    waitingRaw = waitingFee(elapsedSeconds).amount;
  }
  const baseMinor = Math.min(BASE_FAILED_ATTEMPT_FEE_MINOR, input.collectedMinor);
  const totalMinor = Math.min(BASE_FAILED_ATTEMPT_FEE_MINOR + waitingRaw, input.collectedMinor);
  const waitingMinor = totalMinor - baseMinor; // effective waiting after the collected-amount cap
  return { totalMinor, baseMinor, waitingMinor };
}
