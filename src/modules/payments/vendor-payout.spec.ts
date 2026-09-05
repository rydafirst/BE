/**
 * VENDOR PAYOUT money-safety — the core of the marketplace/errand payment model.
 *
 * Proves, through the REAL EscrowService, that goods-money is:
 *   - released escrow -> VENDOR_PAYABLE (never RIDER_PAYABLE — a rider can't be paid the purchase),
 *   - transferred to the VENDOR's bank account, exactly once,
 *   - idempotent (a repeated settle never double-pays),
 *   - durable-then-best-effort: a provider failure leaves the ledger released and the payout pending
 *     for retry, and a retry after success never re-issues the transfer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscrowService } from './escrow.service.js';
import { Money } from './domain/money.js';
import { deriveBalance, type LedgerEntry } from './domain/ledger.js';
import type { IdempotencyRecord } from './domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type LedgerRepository, type IdempotencyStore, type WebhookInboxStore } from './ports.js';
import type { PaymentProvider, VerifiedTxn } from './payment-provider.interface.js';

class FakeLedger implements LedgerRepository {
  entries: LedgerEntry[] = [];
  async append(e: readonly LedgerEntry[]): Promise<void> { this.entries.push(...e); }
  async totals() { return { held: Money.zero(), released: Money.zero(), refunded: Money.zero() }; }
  async sumCreditForJobs() { return 0; }
  async sumCredit(a: string): Promise<number> {
    return this.entries.filter((x) => x.account === a && x.direction === 'CREDIT').reduce((s, x) => s + x.amount.amount, 0);
  }
}
class FakeIdem implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> { return this.m.has(key) ? { key, result: this.m.get(key) as T } : null; }
  async put<T>(key: string, result: T): Promise<void> { if (!this.m.has(key)) this.m.set(key, result); }
  async claim(key: string): Promise<boolean> { if (this.m.has(key)) return false; this.m.set(key, IDEMPOTENCY_PENDING); return true; }
  async complete<T>(key: string, result: T): Promise<void> { this.m.set(key, result); }
}
class FakeInbox implements WebhookInboxStore { async seen() { return false; } async mark() { /* noop */ } }

class TransferSpyProvider implements PaymentProvider {
  transfers: { amountMinor: number; bankCode: string; accountNumber: string; reference: string }[] = [];
  fail = false;
  async initCollection() { return { txRef: 'tx', link: 'https://pay.example/x' }; }
  async verifyTransaction(): Promise<VerifiedTxn> { return { status: 'successful', amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer(p: { amount: Money; bankCode: string; accountNumber: string; reference: string }) {
    if (this.fail) throw new Error('insufficient balance');
    this.transfers.push({ amountMinor: p.amount.amount, bankCode: p.bankCode, accountNumber: p.accountNumber, reference: p.reference });
    return { providerRef: `t_${this.transfers.length}` };
  }
  async refund() { return { providerRef: 'r' }; }
  async getTransfer() { return { status: 'SUCCESSFUL' }; }
  async resolveAccount() { return { accountName: 'SOLA STORES LTD' }; }
  verifyWebhookSignature() { return true; }
}

const VENDOR = { bankCode: '058', accountNumber: '0987654321' };

function mk(provider = new TransferSpyProvider()) {
  const ledger = new FakeLedger();
  const escrow = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  return { escrow, ledger, provider };
}

test('goods-money is released escrow -> VENDOR (never the rider) and transferred to the vendor account once', async () => {
  const { escrow, ledger, provider } = mk();
  // Fund the hold first (as the real flow does), so escrow starts at the goods amount.
  await escrow.confirmFunding('job-1', { status: 'successful', amountMinor: 500000, currency: 'NGN', txRef: 'tx1', transactionId: 'id1' });
  assert.equal(deriveBalance(ledger.entries, 'ESCROW').amount, 500000);

  const r = await escrow.settleVendorPayout({ jobId: 'job-1', amount: Money.of(500000), vendorAccount: VENDOR });
  assert.equal(r.payoutPending, false);
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, 500000);
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0, 'rider is never credited the goods-money');
  assert.equal(deriveBalance(ledger.entries, 'ESCROW').amount, 0, 'the vendor leg drains exactly the goods amount from escrow');
  assert.equal(provider.transfers.length, 1);
  assert.equal(provider.transfers[0]!.accountNumber, VENDOR.accountNumber, 'paid the VENDOR account');
  assert.equal(provider.transfers[0]!.amountMinor, 500000);
});

test('idempotent — a repeated settle pays the vendor exactly once', async () => {
  const { escrow, provider } = mk();
  await escrow.settleVendorPayout({ jobId: 'job-2', amount: Money.of(300000), vendorAccount: VENDOR });
  await escrow.settleVendorPayout({ jobId: 'job-2', amount: Money.of(300000), vendorAccount: VENDOR });
  assert.equal(provider.transfers.length, 1, 'vendor paid once despite two settles');
});

test('a provider failure leaves the ledger released + payout pending; retry pays once and never double-pays', async () => {
  const provider = new TransferSpyProvider();
  provider.fail = true;
  const { escrow, ledger } = mk(provider);

  const r1 = await escrow.settleVendorPayout({ jobId: 'job-3', amount: Money.of(200000), vendorAccount: VENDOR });
  assert.equal(r1.payoutPending, true);
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, 200000, 'ledger release is durable even when the transfer fails');
  assert.equal(provider.transfers.length, 0);

  provider.fail = false; // provider recovers; admin retry succeeds
  const r2 = await escrow.retryVendorPayout({ jobId: 'job-3', amount: Money.of(200000), vendorAccount: VENDOR });
  assert.equal(r2.payoutPending, false);
  assert.equal(provider.transfers.length, 1);

  await escrow.retryVendorPayout({ jobId: 'job-3', amount: Money.of(200000), vendorAccount: VENDOR });
  assert.equal(provider.transfers.length, 1, 'no double-pay on a retry after success');
});

test('rejects a zero payout amount', async () => {
  const { escrow } = mk();
  await assert.rejects(() => escrow.settleVendorPayout({ jobId: 'job-4', amount: Money.zero(), vendorAccount: VENDOR }));
});
