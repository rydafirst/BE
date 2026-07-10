import { Money } from './money.js';

export type SettlementOutcome =
  | 'RELEASE_FULL'      // rider delivered/completed -> full amount to rider
  | 'REFUND_FULL'       // failed before any chargeable effort -> full refund
  | 'FAILED_ATTEMPT'    // rider showed up, receiver unavailable -> attempt fee to rider, rest refunded
  | 'DISPUTE_SPLIT';    // admin/auto split -> explicit rider share, rest refunded

export interface SettlementInput {
  collected: Money;                 // exact amount held in escrow
  outcome: SettlementOutcome;
  attemptFee?: Money;               // for FAILED_ATTEMPT
  riderShare?: Money;               // for DISPUTE_SPLIT
}

export interface Settlement {
  toRider: Money;
  toCustomer: Money;
}

/**
 * Pure settlement calculator. INVARIANT (asserted): toRider + toCustomer === collected.
 * A job can never disburse more than was collected. Fees are capped at the collected amount.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const { collected, outcome } = input;
  let toRider: Money;

  switch (outcome) {
    case 'RELEASE_FULL':
      toRider = collected;
      break;
    case 'REFUND_FULL':
      toRider = Money.zero(collected.currency);
      break;
    case 'FAILED_ATTEMPT': {
      const fee = input.attemptFee ?? Money.zero(collected.currency);
      toRider = fee.cappedAt(collected);
      break;
    }
    case 'DISPUTE_SPLIT': {
      const share = input.riderShare ?? Money.zero(collected.currency);
      toRider = share.cappedAt(collected);
      break;
    }
    default: {
      // Exhaustiveness guard: unknown outcomes fail closed.
      const _never: never = outcome;
      throw new Error(`Unhandled settlement outcome: ${String(_never)}`);
    }
  }

  const toCustomer = collected.subtract(toRider);

  // Hard invariant — the sum must always reconcile to the collected amount.
  if (!toRider.add(toCustomer).equals(collected)) {
    throw new Error('Settlement invariant violated: parts do not sum to collected amount');
  }
  return { toRider, toCustomer };
}
