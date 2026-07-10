import { Money } from './money.js';

/** Totals we can compare between our ledger and the provider's records. */
export interface EscrowTotals {
  held: Money;
  released: Money;
  refunded: Money;
}

export interface ReconciliationResult {
  inSync: boolean;
  drift: { held: number; released: number; refunded: number }; // ours - provider, in minor units
}

/**
 * Compare our ledger totals to the provider's. Any non-zero drift means STOP automated
 * payouts for this scope and alert on-call — never auto-"fix" (fail-closed, §2.7).
 */
export function reconcile(ours: EscrowTotals, provider: EscrowTotals): ReconciliationResult {
  const drift = {
    held: ours.held.amount - provider.held.amount,
    released: ours.released.amount - provider.released.amount,
    refunded: ours.refunded.amount - provider.refunded.amount,
  };
  const inSync = drift.held === 0 && drift.released === 0 && drift.refunded === 0;
  return { inSync, drift };
}
