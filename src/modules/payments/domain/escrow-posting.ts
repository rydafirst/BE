import { Money } from './money.js';
import type { Settlement } from './refund.js';
import type { LedgerEntry } from './ledger.js';
import { assertBalanced } from './ledger.js';

/** HOLD: funds move from the outside world into escrow for a job. */
export function buildHoldPosting(jobId: string, amount: Money): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { jobId, account: 'EXTERNAL', direction: 'DEBIT', amount },
    { jobId, account: 'ESCROW', direction: 'CREDIT', amount },
  ];
  assertBalanced(entries);
  return entries;
}

/**
 * SETTLE: escrow is drained into rider payable + platform revenue + customer refund exactly.
 * Works uniformly for release / refund / failed-attempt / split — the Settlement already
 * guarantees toRider + toPlatform + toCustomer == collected (see refund.ts).
 * Zero-value legs are omitted; the result is always balanced.
 */
export function buildSettlementPosting(jobId: string, settlement: Settlement): LedgerEntry[] {
  const total = settlement.toRider.add(settlement.toPlatform).add(settlement.toCustomer);
  const entries: LedgerEntry[] = [{ jobId, account: 'ESCROW', direction: 'DEBIT', amount: total }];
  if (!settlement.toRider.isZero()) {
    entries.push({ jobId, account: 'RIDER_PAYABLE', direction: 'CREDIT', amount: settlement.toRider });
  }
  if (!settlement.toPlatform.isZero()) {
    entries.push({ jobId, account: 'PLATFORM_FEE', direction: 'CREDIT', amount: settlement.toPlatform });
  }
  if (!settlement.toCustomer.isZero()) {
    entries.push({ jobId, account: 'CUSTOMER_REFUND', direction: 'CREDIT', amount: settlement.toCustomer });
  }
  assertBalanced(entries);
  return entries;
}

/**
 * VENDOR PAYOUT: goods-money for an errand/marketplace order moves from escrow to the vendor. This is
 * a SEPARATE leg from the rider settlement — the rider is never credited the goods-money, so a rider
 * can never be paid the customer's purchase amount. Balanced: escrow debit == vendor credit.
 */
export function buildVendorPayoutPosting(jobId: string, amount: Money): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    { jobId, account: 'ESCROW', direction: 'DEBIT', amount },
    { jobId, account: 'VENDOR_PAYABLE', direction: 'CREDIT', amount },
  ];
  assertBalanced(entries);
  return entries;
}
