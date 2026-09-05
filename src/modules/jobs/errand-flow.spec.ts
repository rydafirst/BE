/**
 * ERRAND ("buy-for-me") end-to-end money-safety, through the REAL JobsService + EscrowService.
 *
 * Proves:
 *   - CREATE: an errand is priced like a delivery for the trip, plus the customer's goods amount, held in escrow.
 *   - VENDOR PAYOUT: the rider captures the vendor account, the customer approves, and the goods-money is
 *     transferred to the VENDOR account (not the rider), releasing escrow -> VENDOR_PAYABLE.
 *   - COMPLETION: on delivery the rider earns ONLY the delivery fee (goods excluded), and the whole escrow
 *     conserves: vendor + rider + platform == what the customer paid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobsService } from './jobs.service.js';
import { InMemoryJobRepo } from './adapters/in-memory-job.repo.js';
import { EscrowService } from '../payments/escrow.service.js';
import { Money } from '../payments/domain/money.js';
import { deriveBalance, type LedgerEntry } from '../payments/domain/ledger.js';
import type { IdempotencyRecord } from '../payments/domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type LedgerRepository, type IdempotencyStore, type WebhookInboxStore } from '../payments/ports.js';
import type { PaymentProvider, VerifiedTxn } from '../payments/payment-provider.interface.js';
import { computeFare } from './domain/fare.js';
import { routeDistanceMeters } from './domain/geo.js';
import type { Env } from '../../config/env.validation.js';

class FakeLedger implements LedgerRepository {
  entries: LedgerEntry[] = [];
  async append(e: readonly LedgerEntry[]): Promise<void> { this.entries.push(...e); }
  async totals() { return { held: Money.zero(), released: Money.zero(), refunded: Money.zero() }; }
  async sumCreditForJobs() { return 0; }
  async sumCredit(a: string): Promise<number> { return this.entries.filter((x) => x.account === a && x.direction === 'CREDIT').reduce((s, x) => s + x.amount.amount, 0); }
}
class FakeIdem implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> { return this.m.has(key) ? { key, result: this.m.get(key) as T } : null; }
  async put<T>(key: string, result: T): Promise<void> { if (!this.m.has(key)) this.m.set(key, result); }
  async claim(key: string): Promise<boolean> { if (this.m.has(key)) return false; this.m.set(key, IDEMPOTENCY_PENDING); return true; }
  async complete<T>(key: string, result: T): Promise<void> { this.m.set(key, result); }
}
class FakeInbox implements WebhookInboxStore { async seen() { return false; } async mark() { /* noop */ } }
class Provider implements PaymentProvider {
  transfers: { accountNumber: string; amountMinor: number }[] = [];
  async initCollection() { return { txRef: `tx-${Math.random().toString(36).slice(2)}`, link: 'https://pay/x' }; }
  async verifyTransaction(): Promise<VerifiedTxn> { return { status: 'successful', amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer(p: { amount: Money; accountNumber: string }) { this.transfers.push({ accountNumber: p.accountNumber, amountMinor: p.amount.amount }); return { providerRef: `t_${this.transfers.length}` }; }
  async refund() { return { providerRef: 'r' }; }
  async getTransfer() { return { status: 'SUCCESSFUL' }; }
  async resolveAccount() { return { accountName: 'SOLASHINE VENTURES LTD' }; }
  verifyWebhookSignature() { return true; }
}

const RIDER = { bankCode: '058', accountNumber: '0123456789' };
const RIDER_ID = 'rider-1';
const VENDOR = { bankCode: '058', accountNumber: '0987654321' };
const QUOTE_SECRET = 'test-quote-secret-value-1234567890';
const PICKUP = { lat: 6.50, lng: 3.30 };   // the store
const DROPOFF = { lat: 6.52, lng: 3.33 };  // the customer

function build() {
  const env = { DELIVERY_MODE: 'direct', JOBS_QUOTE_SECRET: QUOTE_SECRET, HASH_PEPPER: 'pepper-errand-abcdef', WEB_APP_URL: 'https://app.example.com', PAYMENT_WINDOW_MINUTES: 20, ARRIVAL_RADIUS_M: 120 } as unknown as Env;
  const repo = new InMemoryJobRepo();
  const ledger = new FakeLedger();
  const provider = new Provider();
  const escrow = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  const svc = new JobsService(
    env, repo,
    { getPayout: async () => RIDER } as unknown as never, { hit: async () => true } as unknown as never, escrow,
    { record: async () => {}, announceToRiders: async () => {} } as unknown as never,
    { listOnline: async () => [] } as unknown as never, { isRiderCleared: async () => true } as unknown as never,
    {} as unknown as never, { enforceRiderClearance: async () => false } as unknown as never,
    { hasAccount: async () => true } as unknown as never, { getEmail: async () => 'buyer@example.com' } as unknown as never,
    { photoUrl: async () => undefined } as unknown as never, { numberFor: async () => ({}) } as unknown as never,
    { append: async () => {}, list: async () => [], stalledSince: async () => [] } as unknown as never,
    { enabled: () => false } as unknown as never,
  );
  return { svc, repo, ledger, provider };
}

async function bookErrand(svc: JobsService, customer: string, goodsMinor: number) {
  const quote = svc.quote({ type: 'ERRAND', pickup: PICKUP, dropoff: DROPOFF });
  const created = await svc.createErrand(customer, { quoteToken: quote.quoteToken, goodsMinor, shoppingList: 'Bread and milk', storeName: 'Sola Store' } as never);
  await svc.confirmFundedByTxRef({ status: 'successful', amountMinor: created.amountMinor, currency: 'NGN', txRef: created.flwTxRef!, transactionId: `txn-${customer}` });
  return created;
}

const GOODS = 500000; // ₦5,000 declared

test('CREATE: an errand is priced (trip like delivery) + goods, and stores the errand details', async () => {
  const { svc, repo } = build();
  const fare = computeFare('ERRAND', routeDistanceMeters([PICKUP, DROPOFF]));
  const created = await bookErrand(svc, 'cust-e1', GOODS);
  assert.equal(created.type, 'ERRAND');
  assert.equal(created.amountMinor, fare.totalMinor + GOODS, 'customer pays delivery fee + goods');
  const stored = (await repo.find(created.id))!;
  assert.equal(stored.errand?.goodsMinor, GOODS);
  assert.equal(stored.errand?.shoppingList, 'Bread and milk');
});

test('VENDOR PAYOUT: rider captures the account, customer approves, goods go to the VENDOR (not the rider)', async () => {
  const { svc, ledger, provider } = build();
  const created = await bookErrand(svc, 'cust-e2', GOODS);
  await svc.accept(RIDER_ID, created.id);

  const cap = await svc.captureVendorAccount(RIDER_ID, created.id, VENDOR.bankCode, VENDOR.accountNumber);
  assert.equal(cap.accountName, 'SOLASHINE VENTURES LTD');
  assert.equal(cap.match, true, 'name enquiry matches the store name "Sola Store"');

  await svc.approveVendorAccount('cust-e2', created.id);
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, GOODS);
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0, 'no goods-money to the rider');
  const vendorTransfer = provider.transfers.find((t) => t.accountNumber === VENDOR.accountNumber);
  assert.ok(vendorTransfer && vendorTransfer.amountMinor === GOODS, 'the vendor account received exactly the goods amount');

  // A proof-of-payment receipt is now available to both the customer and the assigned rider.
  const rcCustomer = await svc.errandReceipt('cust-e2', created.id);
  assert.equal(rcCustomer.amountMinor, GOODS, 'receipt shows the amount paid to the shop');
  assert.ok(rcCustomer.vendorName.length > 0 && rcCustomer.vendorAccountMasked.endsWith('4321'), 'receipt names the shop account (masked)');
  const rcRider = await svc.errandReceipt(RIDER_ID, created.id);
  assert.equal(rcRider.receiptNo, rcCustomer.receiptNo, 'the same receipt is visible to the rider');
  await assert.rejects(svc.errandReceipt('someone-else', created.id), 'a stranger cannot read the receipt');
});

test('COMPLETION: the rider earns ONLY the delivery fee; the whole escrow conserves', async () => {
  const { svc, ledger, provider } = build();
  const fare = computeFare('ERRAND', routeDistanceMeters([PICKUP, DROPOFF]));
  const created = await bookErrand(svc, 'cust-e3', GOODS);
  await svc.accept(RIDER_ID, created.id);
  await svc.captureVendorAccount(RIDER_ID, created.id, VENDOR.bankCode, VENDOR.accountNumber);
  await svc.approveVendorAccount('cust-e3', created.id);

  // Drive the trip to the customer and complete.
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, created.id, PICKUP, 0);
  await svc.advance(RIDER_ID, created.id, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, created.id, DROPOFF, 0);
  await svc.completeDelivery(RIDER_ID, created.id);

  const riderNet = fare.totalMinor - fare.platformFeeMinor;
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, riderNet, 'rider earns the fee minus platform cut only');
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, fare.platformFeeMinor);
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, GOODS);
  // Conservation: vendor + rider + platform == what the customer paid.
  assert.equal(
    deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount + riderNet + fare.platformFeeMinor,
    created.amountMinor,
  );
  assert.ok(provider.transfers.some((t) => t.accountNumber === RIDER.accountNumber && t.amountMinor === riderNet), 'rider paid the fee to the rider account');
});

const TOPUP = 200000; // ₦2,000 the shop is more expensive than declared

test('TOP-UP: extra money grows the goods (paid to the vendor); the rider fee never changes', async () => {
  const { svc, repo, ledger, provider } = build();
  const fare = computeFare('ERRAND', routeDistanceMeters([PICKUP, DROPOFF]));
  const created = await bookErrand(svc, 'cust-e4', GOODS);
  await svc.accept(RIDER_ID, created.id);

  // Rider at the store: the price is higher, so ask the customer to add ₦2,000.
  const req = await svc.requestErrandTopUp(RIDER_ID, created.id, TOPUP);
  assert.equal(req.requestedTopUpMinor, TOPUP);

  // Customer starts the top-up (separate collection with its own txRef) and it funds via webhook.
  const start = await svc.startErrandTopUp('cust-e4', created.id);
  assert.equal(start.amountMinor, TOPUP);
  const topUpRef = (await repo.find(created.id))!.errand!.topUpTxRef!;
  const res = await svc.confirmFundedByTxRef({ status: 'successful', amountMinor: TOPUP, currency: 'NGN', txRef: topUpRef, transactionId: 'txn-topup-4' });
  assert.equal(res.funded, true);

  const afterTopUp = (await repo.find(created.id))!.errand!;
  assert.equal(afterTopUp.goodsMinor, GOODS + TOPUP, 'goods grew by the top-up');
  assert.equal(afterTopUp.requestedTopUpMinor, 0, 'the pending request is cleared');

  // Replaying the same top-up webhook must NOT double-count.
  await svc.confirmFundedByTxRef({ status: 'successful', amountMinor: TOPUP, currency: 'NGN', txRef: topUpRef, transactionId: 'txn-topup-4' });
  assert.equal((await repo.find(created.id))!.errand!.goodsMinor, GOODS + TOPUP, 'idempotent: no double top-up');

  // Capture + approve: the vendor is paid the HIGHER goods amount, the rider still only the fee.
  await svc.captureVendorAccount(RIDER_ID, created.id, VENDOR.bankCode, VENDOR.accountNumber);
  await svc.approveVendorAccount('cust-e4', created.id);
  const vendorTransfer = provider.transfers.find((t) => t.accountNumber === VENDOR.accountNumber);
  assert.ok(vendorTransfer && vendorTransfer.amountMinor === GOODS + TOPUP, 'vendor received declared + top-up');

  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, created.id, PICKUP, 0);
  await svc.advance(RIDER_ID, created.id, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, created.id, DROPOFF, 0);
  await svc.completeDelivery(RIDER_ID, created.id);

  const riderNet = fare.totalMinor - fare.platformFeeMinor;
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, riderNet, 'rider fee unchanged by the top-up');
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, GOODS + TOPUP);
  // Conservation: vendor + rider + platform == everything the customer paid (booking + top-up).
  assert.equal(
    deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount + riderNet + fare.platformFeeMinor,
    created.amountMinor + TOPUP,
  );
});
