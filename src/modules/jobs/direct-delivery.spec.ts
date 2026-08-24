/**
 * #0 DIRECT DELIVERY — the launch default (DELIVERY_MODE='direct').
 *
 * Proves the plain, direct trip end to end through the REAL JobsService + EscrowService:
 *   book -> pay into escrow -> accept -> pickup -> deliver -> completeDelivery -> escrow releases.
 * And proves the safety/contract properties of direct mode:
 *   - NO return deposit is ever pre-charged (the escrow hold is the plain fare only);
 *   - NO waiting fee is ever charged, and the release is exactly fare-minus-platform-fee;
 *   - the fallback-only endpoints (start-waiting, failed-attempt, return) fail closed with a 409;
 *   - escrow can ONLY release via the funded completeDelivery path (fail-closed money invariant).
 * A final test flips DELIVERY_MODE='fallback' and shows the old return-deposit pre-charge returns —
 * i.e. the whole change is reversible behind the one config flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { InMemoryJobRepo } from './adapters/in-memory-job.repo.js';
import { EscrowService } from '../payments/escrow.service.js';
import { Money } from '../payments/domain/money.js';
import { deriveBalance, type LedgerEntry } from '../payments/domain/ledger.js';
import type { IdempotencyRecord } from '../payments/domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type LedgerRepository, type IdempotencyStore, type WebhookInboxStore } from '../payments/ports.js';
import type { PaymentProvider, VerifiedTxn } from '../payments/payment-provider.interface.js';
import { computeFare } from './domain/fare.js';
import { haversineMeters } from './domain/geo.js';
import type { Env } from '../../config/env.validation.js';

// --- Payment infra fakes (mirrors escrow.service.spec.ts) -------------------------------------
class FakeLedger implements LedgerRepository {
  entries: LedgerEntry[] = [];
  async append(e: readonly LedgerEntry[]): Promise<void> { this.entries.push(...e); }
  async totals() { return { held: Money.zero(), released: Money.zero(), refunded: Money.zero() }; }
  async sumCreditForJobs() { return 0; }
  async sumCredit(account: string): Promise<number> {
    return this.entries.filter((x) => x.account === account && x.direction === 'CREDIT').reduce((s, x) => s + x.amount.amount, 0);
  }
}
class FakeIdem implements IdempotencyStore {
  private m = new Map<string, unknown>();
  async get<T>(key: string): Promise<IdempotencyRecord<T> | null> { return this.m.has(key) ? { key, result: this.m.get(key) as T } : null; }
  async put<T>(key: string, result: T): Promise<void> { if (!this.m.has(key)) this.m.set(key, result); }
  async claim(key: string): Promise<boolean> { if (this.m.has(key)) return false; this.m.set(key, IDEMPOTENCY_PENDING); return true; }
  async complete<T>(key: string, result: T): Promise<void> { this.m.set(key, result); }
}
class FakeInbox implements WebhookInboxStore {
  async seen() { return false; }
  async mark() { /* noop */ }
}
class OkProvider implements PaymentProvider {
  transferCalls = 0;
  refundCalls = 0;
  async initCollection() { return { txRef: 'tx-ref-1', link: 'https://pay.example/x' }; }
  async verifyTransaction(): Promise<VerifiedTxn> { return { status: 'successful', amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer() { this.transferCalls++; return { providerRef: `t_${this.transferCalls}` }; }
  async refund() { this.refundCalls++; return { providerRef: `r_${this.refundCalls}` }; }
  async resolveAccount() { return { accountName: 'Test' }; }
  async getTransfer() { return { status: 'SUCCESSFUL' }; }
  verifyWebhookSignature() { return true; }
}

const RIDER = { bankCode: '058', accountNumber: '0123456789' };
const PICKUP = { lat: 6.5, lng: 3.3 };
const DROPOFF = { lat: 6.51, lng: 3.31 }; // ~1.4 km away — well over MIN_TRIP_METERS
const CUSTOMER = 'cust-1';
const RIDER_ID = 'rider-1';

function build(mode: 'direct' | 'fallback') {
  const env = {
    DELIVERY_MODE: mode,
    JOBS_QUOTE_SECRET: 'test-quote-secret-value-1234567890',
    WEB_APP_URL: 'https://app.example.com',
    PAYMENT_WINDOW_MINUTES: 20,
    ARRIVAL_RADIUS_M: 120,
  } as unknown as Env;

  const repo = new InMemoryJobRepo();
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const escrow = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());

  const notify = { record: async () => {}, announceToRiders: async () => {} };
  const presence = { listOnline: async () => [] as string[] };
  const documents = { isRiderCleared: async () => true };
  const ratings = {};
  const settings = { enforceRiderClearance: async () => false };
  const riderAccount = { hasAccount: async () => true };
  const customerEmail = { getEmail: async () => 'buyer@example.com' };
  const customerPhoto = { photoUrl: async () => undefined };
  const contact = { numberFor: async () => ({}) };
  const statusLog = { append: async () => {}, list: async () => [], stalledSince: async () => [] };
  const calls = { enabled: () => false };
  const payout = { getPayout: async () => RIDER };
  const limiter = { hit: async () => true };

  const svc = new JobsService(
    env,
    repo,
    payout as unknown as never,
    limiter as unknown as never,
    escrow,
    notify as unknown as never,
    presence as unknown as never,
    documents as unknown as never,
    ratings as unknown as never,
    settings as unknown as never,
    riderAccount as unknown as never,
    customerEmail as unknown as never,
    customerPhoto as unknown as never,
    contact as unknown as never,
    statusLog as unknown as never,
    calls as unknown as never,
  );
  return { svc, repo, ledger, provider };
}

/** Drive book -> fund -> accept -> pickup -> deliver, returning the created job + services. */
async function bookAndFund(svc: JobsService) {
  const quote = svc.quote({ type: 'DELIVERY', pickup: PICKUP, dropoff: DROPOFF });
  // Direct mode: NO fallbackPolicy is sent — a plain booking must be accepted.
  const created = await svc.createJob(CUSTOMER, {
    quoteToken: quote.quoteToken,
    recipient: { name: 'Ada', phone: '08030000000' },
    item: 'Documents',
  } as never);
  const verified: VerifiedTxn = {
    status: 'successful',
    amountMinor: created.amountMinor,
    currency: 'NGN',
    txRef: created.flwTxRef!,
    transactionId: 'txn-1',
  };
  await svc.confirmFundedByTxRef(verified);
  return created;
}

test('DIRECT: a plain booking has NO return deposit — the escrow hold is the fare only', async () => {
  const { svc } = build('direct');
  const fare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF));
  const created = await bookAndFund(svc);
  assert.equal(created.amountMinor, fare.totalMinor, 'hold must equal the plain fare');
  assert.equal(created.returnReserveMinor, undefined, 'no return reserve pre-charged in direct mode');
});

test('DIRECT: funds -> confirm code -> release, exactly fare-minus-fee to the rider, no waiting fee', async () => {
  const { svc, repo, ledger, provider } = build('direct');
  const fare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF));
  const created = await bookAndFund(svc);

  // Funded => SEARCHING, so a rider can accept.
  assert.equal((await repo.find(created.id))!.status, 'SEARCHING');

  await svc.accept(RIDER_ID, created.id);
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, created.id, PICKUP, 0);
  await svc.advance(RIDER_ID, created.id, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, created.id, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, created.id, DROPOFF, 0);

  // Recipient code confirmed (JobsService.completeDelivery is what ConfirmationService calls).
  const res = await svc.completeDelivery(RIDER_ID, created.id);
  assert.equal(res.status, 'RELEASED');

  // Money invariant: rider gets fare minus the platform fee; platform keeps its fee; NOTHING refunded.
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, fare.totalMinor - fare.platformFeeMinor);
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, fare.platformFeeMinor);
  assert.equal(deriveBalance(ledger.entries, 'CUSTOMER_REFUND').amount, 0);
  assert.equal(deriveBalance(ledger.entries, 'ESCROW').amount, 0, 'escrow fully drained');
  assert.equal(provider.transferCalls, 1, 'rider paid exactly once');
  assert.equal(provider.refundCalls, 0, 'no return-deposit refund in direct mode');
});

test('DIRECT is fail-closed: fallback-only endpoints return 409, opening no money path', async () => {
  const { svc, repo } = build('direct');
  const created = await bookAndFund(svc);
  await svc.accept(RIDER_ID, created.id);

  await assert.rejects(() => svc.startWaiting(RIDER_ID, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.escalateResolution(RIDER_ID, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.chargeWaiting(RIDER_ID, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.payWaiting(CUSTOMER, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.keepWaiting(CUSTOMER, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.initiateReturn(CUSTOMER, created.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(() => svc.failedAttempt(RIDER_ID, created.id), (e: unknown) => e instanceof ConflictException);

  // The job never left its lifecycle state — no money moved, nothing settled.
  assert.equal((await repo.find(created.id))!.status, 'ACCEPTED');
});

test('REVERSIBLE: DELIVERY_MODE=fallback restores the 75% return-deposit pre-charge', async () => {
  const { svc } = build('fallback');
  const fare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF));
  const quote = svc.quote({ type: 'DELIVERY', pickup: PICKUP, dropoff: DROPOFF });
  const created = await svc.createJob(CUSTOMER, {
    quoteToken: quote.quoteToken,
    recipient: { name: 'Ada', phone: '08030000000' },
    fallbackPolicy: 'RETURN',
  } as never);
  // Old behaviour intact: the hold is fare + 75% return reserve.
  assert.equal(created.returnReserveMinor, Math.round((fare.totalMinor * 75) / 100));
  assert.equal(created.amountMinor, fare.totalMinor + created.returnReserveMinor!);
});
