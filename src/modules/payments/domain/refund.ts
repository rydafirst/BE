import { Money } from './money.js';

export type SettlementOutcome =
  | 'RELEASE_FULL'      // rider delivered/completed -> full amount to rider
  | 'REFUND_FULL'       // failed before any chargeable effort -> full refund
  | 'FAILED_ATTEMPT'    // rider showed up, receiver unavailable -> attempt fee to rider, rest refunded
  | 'DISPUTE_SPLIT';    // admin/auto split -> explicit rider share, rest refunded

export interface SettlementInput {
  collected: Money;                 // exact amount held in escrow (customer paid this)
  outcome: SettlementOutcome;
  platformFee?: Money;              // for RELEASE_FULL — the platform's cut of a completed delivery
  attemptFee?: Money;               // for FAILED_ATTEMPT
  riderShare?: Money;               // for DISPUTE_SPLIT
}

export interface Settlement {
  toRider: Money;    // the rider's earnings (paid out to their bank)
  toPlatform: Money; // Rydafirst's revenue (kept)
  toCustomer: Money; // refunded to the customer's source
}

/**
 * Pure settlement calculator. INVARIANT (asserted): toRider + toPlatform + toCustomer === collected.
 * A job can never disburse more than was collected; every part is capped at the collected amount.
 * The platform only earns on a completed delivery (RELEASE_FULL); on refunds, failed attempts and
 * dispute splits it takes nothing — money returns to the rider (for effort) and/or the customer.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const { collected, outcome } = input;
  const zero = Money.zero(collected.currency);
  let toRider: Money;
  let toPlatform: Money;

  switch (outcome) {
    case 'RELEASE_FULL': {
      // Platform keeps its fee (never more than what was collected); rider gets the remainder.
      toPlatform = (input.platformFee ?? zero).cappedAt(collected);
      toRider = collected.subtract(toPlatform);
      break;
    }
    case 'REFUND_FULL':
      toPlatform = zero;
      toRider = zero;
      break;
    case 'FAILED_ATTEMPT':
      toPlatform = zero;
      toRider = (input.attemptFee ?? zero).cappedAt(collected);
      break;
    case 'DISPUTE_SPLIT':
      toPlatform = zero;
      toRider = (input.riderShare ?? zero).cappedAt(collected);
      break;
    default: {
      // Exhaustiveness guard: unknown outcomes fail closed.
      const _never: never = outcome;
      throw new Error(`Unhandled settlement outcome: ${String(_never)}`);
    }
  }

  const toCustomer = collected.subtract(toRider).subtract(toPlatform);

  // Hard invariant — the three parts must always reconcile to the collected amount.
  if (!toRider.add(toPlatform).add(toCustomer).equals(collected)) {
    throw new Error('Settlement invariant violated: parts do not sum to collected amount');
  }
  return { toRider, toPlatform, toCustomer };
}
