/**
 * STACKED DELIVERIES — a rider may hold up to MAX_ACTIVE_JOBS_PER_RIDER engaged deliveries at once.
 *
 * The whole point of these tests is to prove the thing that matters for money: two concurrent jobs on
 * the SAME rider are fully independent. Completing (or cancelling) one must never move, release, or
 * touch the other's escrow or status. We drive two real jobs through the real JobsService + EscrowService
 * and assert each settles on its own, exactly once, with no cross-contamination — plus the cap is
 * enforced (the N+1th accept is refused) and the old single-delivery rule is restorable via config.
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
class FakeInbox implements WebhookInboxStore { async seen() { return false; } async mark() {} }
class OkProvider implements PaymentProvider {
  transferCalls = 0; refundCalls = 0; transferRefs: string[] = [];
  async initCollection() { return { txRef: `tx-${Math.random().toString(36).slice(2)}`, link: 'https://pay.example/x' }; }
  async verifyTransaction(): Promise<VerifiedTxn> { return { status: 'successful', amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer() { this.transferCalls++; const ref = `t_${this.transferCalls}`; this.transferRefs.push(ref); return { providerRef: ref }; }
  async refund() { this.refundCalls++; return { providerRef: `r_${this.refundCalls}` }; }
  async resolveAccount() { return { accountName: 'Test' }; }
  async getTransfer() { return { status: 'SUCCESSFUL' }; }
  verifyWebhookSignature() { return true; }
}

const RIDER = { bankCode: '058', accountNumber: '0123456789' };
const PICKUP = { lat: 6.5, lng: 3.3 };
const DROPOFF = { lat: 6.51, lng: 3.31 };
const CUSTOMER = 'cust-1';
const RIDER_ID = 'rider-1';

function build(cap?: number) {
  const env = {
    DELIVERY_MODE: 'direct',
    JOBS_QUOTE_SECRET: 'test-quote-secret-value-1234567890',
    WEB_APP_URL: 'https://app.example.com',
    PAYMENT_WINDOW_MINUTES: 20,
    ARRIVAL_RADIUS_M: 120,
    ...(cap !== undefined ? { MAX_ACTIVE_JOBS_PER_RIDER: cap } : {}),
  } as unknown as Env;
  const repo = new InMemoryJobRepo();
  const ledger = new FakeLedger();
  const provider = new OkProvider();
  const escrow = new EscrowService(provider, ledger, new FakeIdem(), new FakeInbox());
  const svc = new JobsService(
    env, repo,
    { getPayout: async () => RIDER } as unknown as never,
    { hit: async () => true } as unknown as never,
    escrow,
    { record: async () => {}, announceToRiders: async () => {} } as unknown as never,
    { listOnline: async () => [] as string[] } as unknown as never,
    { isRiderCleared: async () => true } as unknown as never,
    {} as unknown as never,
    { enforceRiderClearance: async () => false, economyDiscountPct: async () => 20 } as unknown as never,
    { hasAccount: async () => true } as unknown as never,
    { getEmail: async () => 'buyer@example.com' } as unknown as never,
    { photoUrl: async () => undefined } as unknown as never,
    { numberFor: async () => ({}) } as unknown as never,
    { append: async () => {}, list: async () => [], stalledSince: async () => [] } as unknown as never,
    { enabled: () => false } as unknown as never,
  );
  return { svc, repo, ledger, provider };
}

/**
 * Book a fresh delivery and fund it so it reaches SEARCHING (acceptable). Defaults to the ECONOMY tier
 * because only economy deliveries may be stacked — the stacking tests depend on that. Pass a dropoff to
 * steer the trip's direction (for the same-direction guard), or tier:'EXPRESS' for the single-drop tier.
 */
async function bookAndFund(
  svc: JobsService,
  opts?: { tier?: 'EXPRESS' | 'ECONOMY'; dropoff?: typeof DROPOFF },
): Promise<{ id: string; amountMinor: number }> {
  const dropoff = opts?.dropoff ?? DROPOFF;
  const quote = await svc.quote({ type: 'DELIVERY', pickup: PICKUP, dropoff });
  const quoteToken = opts?.tier === 'EXPRESS' ? quote.quoteToken : quote.economy!.quoteToken;
  const created = await svc.createJob(CUSTOMER, {
    quoteToken, recipient: { name: 'Ada', phone: '08030000000' }, item: 'Documents',
  } as never);
  await svc.confirmFundedByTxRef({
    status: 'successful', amountMinor: created.amountMinor, currency: 'NGN', txRef: created.flwTxRef!, transactionId: `txn-${created.id}`,
  });
  return { id: created.id, amountMinor: created.amountMinor };
}

/** Drive one accepted job all the way to RELEASED. */
async function driveToComplete(svc: JobsService, jobId: string): Promise<void> {
  await svc.advance(RIDER_ID, jobId, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, jobId, PICKUP, 0);
  await svc.advance(RIDER_ID, jobId, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, jobId, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, jobId, DROPOFF, 0);
  await svc.completeDelivery(RIDER_ID, jobId);
}

test('CAP: a rider can hold two engaged deliveries, but the third accept is refused', async () => {
  const { svc } = build(); // default cap = 2
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  const c = await bookAndFund(svc);

  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, b.id); // second is allowed now
  await assert.rejects(() => svc.accept(RIDER_ID, c.id), (e: unknown) => e instanceof ConflictException);

  assert.deepEqual((await svc.activeJobIdsForRider(RIDER_ID)).sort(), [a.id, b.id].sort());
});

test('ISOLATION: completing one job releases only that job — the other is untouched', async () => {
  const { svc, repo, provider } = build();
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, b.id);

  // Complete A only.
  await driveToComplete(svc, a.id);
  assert.equal((await repo.find(a.id))!.status, 'RELEASED', 'A is delivered');
  assert.equal((await repo.find(b.id))!.status, 'ACCEPTED', 'B is completely untouched');
  assert.equal(provider.transferCalls, 1, 'only A paid the rider — B did not trigger a payout');

  // Now complete B — it settles on its own.
  await driveToComplete(svc, b.id);
  assert.equal((await repo.find(b.id))!.status, 'RELEASED', 'B is delivered independently');
  assert.equal(provider.transferCalls, 2, 'exactly two payouts, one per job');
  assert.notEqual(provider.transferRefs[0], provider.transferRefs[1], 'distinct payout references — no double-pay');
});

test('MONEY: two stacked jobs each pay the rider fare-minus-fee; escrow fully drains, nothing refunded', async () => {
  const { svc, ledger } = build();
  // Stacked jobs are ECONOMY (only economy stacks), so price them with the same 20% discount the stub uses.
  const fare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF), undefined, 20);
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, b.id);
  await driveToComplete(svc, a.id);
  await driveToComplete(svc, b.id);

  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 2 * (fare.totalMinor - fare.platformFeeMinor), 'rider credited for both');
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, 2 * fare.platformFeeMinor, 'platform keeps both fees');
  assert.equal(deriveBalance(ledger.entries, 'CUSTOMER_REFUND').amount, 0, 'no refunds');
  assert.equal(deriveBalance(ledger.entries, 'ESCROW').amount, 0, 'both escrows fully drained');
});

test('ISOLATION: cancelling one stacked job never affects the other', async () => {
  const { svc, repo } = build();
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, b.id);

  await svc.adminVoidJob(a.id); // force-cancel A (refunds its own escrow only)
  assert.equal((await repo.find(a.id))!.status, 'CANCELLED');
  assert.equal((await repo.find(b.id))!.status, 'ACCEPTED', 'B is unaffected by A being voided');

  // B can still complete normally afterwards.
  await driveToComplete(svc, b.id);
  assert.equal((await repo.find(b.id))!.status, 'RELEASED');
});

test('REVERSIBLE: MAX_ACTIVE_JOBS_PER_RIDER=1 restores the old single-delivery rule', async () => {
  const { svc } = build(1);
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);
  await assert.rejects(() => svc.accept(RIDER_ID, b.id), (e: unknown) => e instanceof ConflictException);
});

test('TIER: express is single-drop — a rider holding one cannot take another', async () => {
  const { svc } = build();
  const a = await bookAndFund(svc, { tier: 'EXPRESS' });
  const b = await bookAndFund(svc, { tier: 'EXPRESS' });
  await svc.accept(RIDER_ID, a.id);
  await assert.rejects(() => svc.accept(RIDER_ID, b.id), (e: unknown) => e instanceof ConflictException);
});

test('TIER: cannot mix — an economy drop cannot be stacked on an express one', async () => {
  const { svc } = build();
  const express = await bookAndFund(svc, { tier: 'EXPRESS' });
  const economy = await bookAndFund(svc, { tier: 'ECONOMY' });
  await svc.accept(RIDER_ID, express.id);
  await assert.rejects(() => svc.accept(RIDER_ID, economy.id), (e: unknown) => e instanceof ConflictException);
});

test('TIER: two economy drops stack only when they head the same way', async () => {
  const { svc } = build();
  // Same direction (NE) — allowed.
  const a = await bookAndFund(svc, { tier: 'ECONOMY', dropoff: { lat: 6.52, lng: 3.32 } });
  const sameWay = await bookAndFund(svc, { tier: 'ECONOMY', dropoff: { lat: 6.53, lng: 3.33 } });
  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, sameWay.id); // ok — same bearing

  // Opposite direction (SW) — refused.
  const { svc: svc2 } = build();
  const c = await bookAndFund(svc2, { tier: 'ECONOMY', dropoff: { lat: 6.52, lng: 3.32 } });
  const otherWay = await bookAndFund(svc2, { tier: 'ECONOMY', dropoff: { lat: 6.48, lng: 3.28 } });
  await svc2.accept(RIDER_ID, c.id);
  await assert.rejects(() => svc2.accept(RIDER_ID, otherWay.id), (e: unknown) => e instanceof ConflictException);
});

test('ADMIN ASSIGN: can hand a job to a rider already at the cap (manual override)', async () => {
  const { svc, repo } = build(); // cap = 2
  const a = await bookAndFund(svc);
  const b = await bookAndFund(svc);
  const c = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);
  await svc.accept(RIDER_ID, b.id);                                   // rider now at the cap
  await assert.rejects(() => svc.accept(RIDER_ID, c.id));             // self-accept is blocked
  const assigned = await svc.adminAssignJob(c.id, RIDER_ID);         // admin override succeeds
  assert.equal(assigned.status, 'ACCEPTED');
  assert.equal(assigned.riderId, RIDER_ID);
  assert.equal((await repo.find(c.id))!.riderId, RIDER_ID);
  assert.equal((await svc.activeJobIdsForRider(RIDER_ID)).length, 3);
});

test('ADMIN ASSIGN: refuses a job that is not searching for a rider', async () => {
  const { svc } = build();
  const a = await bookAndFund(svc);
  await svc.accept(RIDER_ID, a.id);                                   // ACCEPTED, no longer SEARCHING
  await assert.rejects(() => svc.adminAssignJob(a.id, 'rider-2'), (e: unknown) => e instanceof ConflictException);
});
