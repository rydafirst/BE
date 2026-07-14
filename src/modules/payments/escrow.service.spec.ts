/**
 * EscrowService money-flow guarantees (the "airtight" contract):
 *   - the ledger release is written FIRST and durably, even if the external transfer fails;
 *   - a failed rider transfer never throws — it returns payoutPending=true so the delivery still
 *     completes and the job can be retried;
 *   - the platform fee is split out of the rider payout (platform earns its cut);
 *   - settle is idempotent (a replay returns the first result, never a double transfer);
 *   - retryDisbursement re-attempts only the transfer, reusing a stable reference (no double-pay).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EscrowService } from './escrow.service.js';
import { Money } from './domain/money.js';
import { deriveBalance, type LedgerEntry } from './domain/ledger.js';
import type { IdempotencyRecord } from './domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type LedgerRepository, type IdempotencyStore, type WebhookInboxStore } from './ports.js';
import type { PaymentProvider } from './payment-provider.interface.js';

class FakeLedger implements LedgerRepository {
  entries: LedgerEntry[] = [];
  async append(e: readonly LedgerEntry[]): Promise<void> { this.entries.push(...e); }
  async totals() { return { held: Money.zero(), released: Money.zero(), refunded: Money.zero() }; }
  async sumCreditForJobs() { return 0; }
  async sumCredit(account: string): Promise<number> {
    return this.entries.filter((e) => e.account === account && e.direction === 'CREDIT').reduce((s, e) => s + e.amount.amount, 0);
  }
}

class FakeIdem implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> {
    return this.m.has(key) ? { key, result: this.m.get(key) as T } : null;
  }
  async put<T>(key: string, result: T): Promise<void> { if (!this.m.has(key)) this.m.set(key, result); }
  async claim(key: string): Promise<boolean> {
    if (this.m.has(key)) return false;
    this.m.set(key, IDEMPOTENCY_PENDING);
    return true;
  }
  async complete<T>(key: string, result: T): Promise<void> { this.m.set(key, result); }
}

class FakeInbox implements WebhookInboxStore {
  async seen() { return false; }
  async mark() { /* noop */ }
}

/** A provider whose transfer always fails (simulates the Railway "rider didn't get paid" case). */
class FailingProvider implements PaymentProvider {
  transferCalls = 0;
  async initCollection() { return { txRef: 'x', link: 'x' }; }
  async verifyTransaction() { return { status: 'successful' as const, amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer(): Promise<{ providerRef: string }> { this.transferCalls++; throw new Error('boom'); }
  refundCalls = 0;
  async refund() { this.refundCalls++; return { providerRef: `refund_${this.refundCalls}` }; }
  async resolveAccount() { return { accountName: 'Test' }; }
  verifyWebhookSignature() { return true; }
}

class OkProvider implements PaymentProvider {
  transferCalls = 0;
  async initCollection() { return { txRef: 'x', link: 'x' }; }
  async verifyTransaction() { return { status: 'successful' as const, amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer() { this.transferCalls++; return { providerRef: `flw_${this.transferCalls}` }; }
  refundCalls = 0;
  async refund() { this.refundCalls++; return { providerRef: `refund_${this.refundCalls}` }; }
  async resolveAccount() { return { accountName: 'Test' }; }
  verifyWebhookSignature() { return true; }
}

const RIDER = { bankCode: '058', accountNumber: '0123456789' };

test('release is durable and the platform fee is retained even when the rider transfer fails', async () => {
  const ledger = new FakeLedger();
  const provider = new FailingProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());

  const res = await svc.settle({
    jobId: 'job-1', status: 'COMPLETED', outcome: 'RELEASE_FULL',
    collected: Money.of(2300), platformFee: Money.of(300), riderPayout: RIDER,
  });

  // The transfer failed but settle did NOT throw — the delivery can still complete.
  assert.equal(res.payoutPending, true);
  assert.ok(res.payoutError && res.payoutError.length > 0);
  // The ledger release is durable: rider gets the remainder, platform keeps its fee, and the two
  // credit legs reconcile to exactly what was collected (escrow fully drained).
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 2000);
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, 300);
  assert.equal(
    deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount + deriveBalance(ledger.entries, 'PLATFORM_FEE').amount,
    2300,
  );
});

test('settle is idempotent: a replay returns the cached result and never transfers twice', async () => {
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());

  const first = await svc.settle({
    jobId: 'job-2', status: 'COMPLETED', outcome: 'RELEASE_FULL',
    collected: Money.of(2300), platformFee: Money.of(300), riderPayout: RIDER,
  });
  const second = await svc.settle({
    jobId: 'job-2', status: 'COMPLETED', outcome: 'RELEASE_FULL',
    collected: Money.of(2300), platformFee: Money.of(300), riderPayout: RIDER,
  });

  assert.equal(first.payoutPending, false);
  assert.deepEqual(second, first);
  assert.equal(provider.transferCalls, 1);          // exactly once
  assert.equal(ledger.entries.length, 3);           // release posted once (rider+platform+escrow)
});

test('a concurrent settle that loses the claim never double-posts (throws instead)', async () => {
  const ledger = new FakeLedger();
  const idem = new FakeIdem();
  const svc = new EscrowService(new OkProvider(), ledger, idem, new FakeInbox());

  // Simulate another worker having already reserved the settle key mid-flight.
  await idem.claim('settle:job-x:v1');

  await assert.rejects(
    () => svc.settle({
      jobId: 'job-x', status: 'COMPLETED', outcome: 'RELEASE_FULL',
      collected: Money.of(2300), platformFee: Money.of(300), riderPayout: RIDER,
    }),
    /in progress/i,
  );
  // Nothing was posted by the losing caller.
  assert.equal(ledger.entries.length, 0);
});

test('retry after a partial failure re-issues only the failed leg (no double-refund)', async () => {
  // Transfer fails on the first attempt then succeeds; refund succeeds on the first attempt.
  class TransferFlaky implements PaymentProvider {
    transferCalls = 0; refundCalls = 0;
    async initCollection() { return { txRef: 'x', link: 'x' }; }
    async verifyTransaction() { return { status: 'successful' as const, amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
    async transfer(): Promise<{ providerRef: string }> {
      this.transferCalls++;
      if (this.transferCalls === 1) throw new Error('transfer down');
      return { providerRef: `t_${this.transferCalls}` };
    }
    async refund() { this.refundCalls++; return { providerRef: `r_${this.refundCalls}` }; }
    async resolveAccount() { return { accountName: 'Test' }; }
    verifyWebhookSignature() { return true; }
  }
  const provider = new TransferFlaky();
  const svc = new EscrowService(provider, new FakeLedger(), new FakeIdem(), new FakeInbox());

  // FAILED_ATTEMPT: rider gets the fee (transfer leg), customer gets the rest (refund leg).
  const first = await svc.settle({
    jobId: 'job-4', status: 'FAILED_ATTEMPT', outcome: 'FAILED_ATTEMPT',
    collected: Money.of(2300), attemptFee: Money.of(500), riderPayout: RIDER, transactionId: 'txn-1',
  });
  assert.equal(first.payoutPending, true);      // transfer failed
  assert.equal(provider.refundCalls, 1);        // refund already went through

  const retry = await svc.retryDisbursement({
    jobId: 'job-4', status: 'FAILED_ATTEMPT', outcome: 'FAILED_ATTEMPT',
    collected: Money.of(2300), attemptFee: Money.of(500), riderPayout: RIDER, transactionId: 'txn-1',
  });
  assert.equal(retry.payoutPending, false);     // transfer now succeeded
  assert.equal(provider.transferCalls, 2);      // transfer retried
  assert.equal(provider.refundCalls, 1);        // refund NOT re-issued — no double-refund
});

test('waiting fee is released 100% to the rider (no platform cut) and is idempotent', async () => {
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());

  const a = await svc.settleWaitingToRider('job-w', Money.of(15_000), RIDER); // ₦150 waiting
  const b = await svc.settleWaitingToRider('job-w', Money.of(15_000), RIDER); // replay

  assert.equal(a.payoutPending, false);
  assert.deepEqual(b, a);                                   // idempotent
  assert.equal(provider.transferCalls, 1);                  // rider paid exactly once
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 15_000);
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, 0); // no platform cut on waiting
});

test('return reserve: released 100% to the rider on an actual return', async () => {
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  const r = await svc.settleReturnReserveToRider('job-r', Money.of(74_250), RIDER); // 75% reserve
  assert.equal(r.payoutPending, false);
  assert.equal(provider.transferCalls, 1);
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 74_250);
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, 0);
});

test('return reserve: refunded to the customer when the delivery succeeds', async () => {
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  const r = await svc.refundReturnReserveToCustomer('job-r2', Money.of(74_250), 'txn-9');
  assert.equal(r.payoutPending, false);
  assert.equal(provider.refundCalls, 1);
  assert.equal(deriveBalance(ledger.entries, 'CUSTOMER_REFUND').amount, 74_250);
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0);
});

test('retryDisbursement re-attempts the transfer without touching the ledger', async () => {
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const svc = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());

  const res = await svc.retryDisbursement({
    jobId: 'job-3', status: 'COMPLETED', outcome: 'RELEASE_FULL',
    collected: Money.of(2300), platformFee: Money.of(300), riderPayout: RIDER,
  });

  assert.equal(res.payoutPending, false);
  assert.ok(res.providerRef.length > 0);
  assert.equal(ledger.entries.length, 0);           // retry does not re-post the ledger
});
