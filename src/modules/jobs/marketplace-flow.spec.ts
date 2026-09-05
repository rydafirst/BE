/**
 * MARKETPLACE order end-to-end through the REAL JobsService + EscrowService.
 *
 * Proves:
 *   - prices come from the catalog (server-authoritative), not the request;
 *   - the vendor's stored account is pre-approved (no rider capture / customer approval step);
 *   - on delivery confirmation the VENDOR is paid the goods automatically, the RIDER only the fee,
 *     and the whole escrow conserves.
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
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { computeFare } from './domain/fare.js';
import { routeDistanceMeters } from './domain/geo.js';
import type { Env } from '../../config/env.validation.js';
import type { MarketplaceVendorSource } from './marketplace.port.js';

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
const QUOTE_SECRET = 'test-quote-secret-value-1234567890';
const SHOP = { lat: 6.50, lng: 3.30 };
const DROPOFF = { lat: 6.52, lng: 3.33 };
const VENDOR = {
  id: 'vendor-1', businessName: 'Sola Store', area: 'Yaba', status: 'APPROVED',
  shopLat: SHOP.lat, shopLng: SHOP.lng,
  account: { bankCode: '058', accountNumber: '0987654321', accountName: 'SOLASHINE VENTURES LTD' },
};
const PRODUCTS: Record<string, { id: string; vendorId: string; name: string; priceMinor: number; available: boolean }> = {
  p1: { id: 'p1', vendorId: 'vendor-1', name: 'Jollof pack', priceMinor: 250000, available: true },
  p2: { id: 'p2', vendorId: 'vendor-1', name: 'Drink', priceMinor: 80000, available: true },
};

function build() {
  const env = { DELIVERY_MODE: 'direct', JOBS_QUOTE_SECRET: QUOTE_SECRET, HASH_PEPPER: 'pepper-market-abcdef', WEB_APP_URL: 'https://app.example.com', PAYMENT_WINDOW_MINUTES: 20, ARRIVAL_RADIUS_M: 120 } as unknown as Env;
  const repo = new InMemoryJobRepo();
  const ledger = new FakeLedger();
  const provider = new Provider();
  const escrow = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  const vendorSource: MarketplaceVendorSource = {
    async getForOrder() { return VENDOR; },
    async findProduct(id: string) { return PRODUCTS[id] ?? null; },
    async findVendorIdByOwner() { return VENDOR.id; },
  };
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
    new HmacHasher(env), vendorSource,
  );
  return { svc, repo, ledger, provider };
}

test('MARKETPLACE: catalog-priced order pays the vendor automatically on delivery; rider gets only the fee', async () => {
  const { svc, ledger, provider } = build();
  const fare = computeFare('ERRAND', routeDistanceMeters([SHOP, DROPOFF]));
  const GOODS = PRODUCTS.p1!.priceMinor * 2 + PRODUCTS.p2!.priceMinor; // 2× Jollof + 1× Drink = 580000

  const quote = svc.quote({ type: 'ERRAND', pickup: SHOP, dropoff: DROPOFF });
  const created = await svc.createMarketplaceOrder('cust-m1', {
    vendorId: VENDOR.id, quoteToken: quote.quoteToken,
    items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }],
  });
  assert.equal(created.amountMinor, fare.totalMinor + GOODS, 'charged the catalog goods total + delivery fee');
  assert.equal(created.errand?.goodsMinor, GOODS);
  assert.equal(created.errand?.vendorApproved, true, 'vendor account is pre-approved');
  assert.equal(created.errand?.autoVendorPayout, true);

  await svc.confirmFundedByTxRef({ status: 'successful', amountMinor: created.amountMinor, currency: 'NGN', txRef: created.flwTxRef!, transactionId: 'txn-m1' });
  await svc.accept(RIDER_ID, created.id);
  // No captureVendorAccount / approveVendorAccount — the vendor is already set.
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, created.id, SHOP, 0);
  await svc.advance(RIDER_ID, created.id, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, created.id, DROPOFF, 0);
  await svc.completeDelivery(RIDER_ID, created.id);

  const riderNet = fare.totalMinor - fare.platformFeeMinor;
  assert.equal(deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount, GOODS, 'vendor paid the goods automatically');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, riderNet, 'rider earns only the fee');
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, fare.platformFeeMinor);
  assert.equal(
    deriveBalance(ledger.entries, 'VENDOR_PAYABLE').amount + riderNet + fare.platformFeeMinor,
    created.amountMinor, 'conservation: vendor + rider + platform == collected',
  );
  assert.ok(provider.transfers.some((t) => t.accountNumber === VENDOR.account.accountNumber && t.amountMinor === GOODS), 'vendor account received the goods');
});

test('MARKETPLACE: prices are server-authoritative — a foreign product id is rejected', async () => {
  const { svc } = build();
  const quote = svc.quote({ type: 'ERRAND', pickup: SHOP, dropoff: DROPOFF });
  await assert.rejects(svc.createMarketplaceOrder('cust-m2', {
    vendorId: VENDOR.id, quoteToken: quote.quoteToken, items: [{ productId: 'not-a-product', quantity: 1 }],
  }), 'unknown product is rejected');
});
