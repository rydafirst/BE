import { Money } from '../../payments/domain/money.js';

export const GRACE_SECONDS = 600;            // 10 min free wait
export const WAIT_FEE_PER_MIN_MINOR = 5_000; // ₦50 / min after grace
export const MAX_WAIT_FEE_MINOR = 100_000;   // ₦1,000 cap

export type FallbackState = 'WAITING' | 'READY_DELEGATE' | 'FAILED_ATTEMPT';

export function decideFallback(input: {
  elapsedSeconds: number;
  receiverResponded: boolean;
  delegated: boolean;
}): FallbackState {
  if (input.delegated) return 'READY_DELEGATE';
  if (!input.receiverResponded && input.elapsedSeconds > GRACE_SECONDS) return 'FAILED_ATTEMPT';
  return 'WAITING';
}

/** Waiting fee accrues only AFTER the grace window, per whole minute, capped. */
export function waitingFee(elapsedSeconds: number): Money {
  const beyond = Math.max(0, elapsedSeconds - GRACE_SECONDS);
  const minutes = Math.ceil(beyond / 60);
  return Money.of(Math.min(minutes * WAIT_FEE_PER_MIN_MINOR, MAX_WAIT_FEE_MINOR));
}
