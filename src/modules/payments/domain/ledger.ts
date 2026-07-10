import { Money } from './money.js';

/** Internal ledger accounts. Money is conserved across these on every transaction. */
export type LedgerAccount =
  | 'EXTERNAL'        // the outside world (customer's funding source via provider)
  | 'ESCROW'          // funds held by the custodian for a job
  | 'RIDER_PAYABLE'   // owed to the rider
  | 'CUSTOMER_REFUND' // owed back to the customer
  | 'PLATFORM_FEE';   // platform revenue

export type Direction = 'DEBIT' | 'CREDIT';

export interface LedgerEntry {
  jobId: string;
  account: LedgerAccount;
  direction: Direction;
  amount: Money;
}

export class UnbalancedLedgerError extends Error {
  constructor() {
    super('Ledger transaction is unbalanced: debits != credits');
    this.name = 'UnbalancedLedgerError';
  }
}

/** Double-entry invariant: total debits must equal total credits (per currency). */
export function assertBalanced(entries: readonly LedgerEntry[]): void {
  if (entries.length === 0) return;
  const currency = entries[0]!.amount.currency;
  let debits = Money.zero(currency);
  let credits = Money.zero(currency);
  for (const e of entries) {
    if (e.amount.currency !== currency) throw new Error('Mixed currencies in one transaction');
    if (e.direction === 'DEBIT') debits = debits.add(e.amount);
    else credits = credits.add(e.amount);
  }
  if (!debits.equals(credits)) throw new UnbalancedLedgerError();
}

/** Net balance of an account = credits - debits (throws if it would go negative). */
export function deriveBalance(entries: readonly LedgerEntry[], account: LedgerAccount): Money {
  let credits = Money.zero();
  let debits = Money.zero();
  for (const e of entries) {
    if (e.account !== account) continue;
    if (e.direction === 'CREDIT') credits = credits.add(e.amount);
    else debits = debits.add(e.amount);
  }
  return credits.subtract(debits);
}
