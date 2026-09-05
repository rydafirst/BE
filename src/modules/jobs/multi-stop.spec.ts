/**
 * #4 MULTI-STOP DELIVERIES — one pickup, several ordered drop-offs in a single booking.
 *
 * Proves the money-critical properties through the REAL JobsService + EscrowService:
 *   - FARE: a 3-drop route is priced for the WHOLE path (strictly more than the first leg alone), and
 *     the fare breakdown rows still sum to the total.
 *   - CREATE: a multi-stop job stores N extra stops PENDING with N distinct codes, and the signed
 *     multi-leg total is re-verified on createJob (tamper-guard) — an under-priced token is rejected.
 *   - MONEY-SAFETY (the whole point): delivering the primary drop-off and stops 1..N-1 releases NOTHING;
 *     only the FINAL stop releases escrow, exactly once, for fare-minus-fee. A wrong code delivers
 *     nothing. Single-stop is unchanged: the one code releases immediately.
 *   - STATE MACHINE: the job only reaches COMPLETED/RELEASED once every stop is delivered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { InMemoryJobRepo } from './adapters/in-memory-job.repo.js';
import { EscrowService } from '../payments/escrow.service.js';
import { Money } from '../payments/domain/money.js';
import { deriveBalance, type LedgerEntry } from '../payments/domain/ledger.js';
import type { IdempotencyRecord } from '../payments/domain/idempotency.js';
import { IDEMPOTENCY_PENDING, type LedgerRepository, type IdempotencyStore, type WebhookInboxStore } from '../payments/ports.js';
import type { PaymentProvider, VerifiedTxn } from '../payments/payment-provider.interface.js';
import { computeFare } from './domain/fare.js';
import { haversineMeters, routeDistanceMeters } from './domain/geo.js';
import { canTransition } from './domain/job-state-machine.js';
import { signQuote } from './domain/quote-token.js';
import type { Env } from '../../config/env.validation.js';

// --- Payment infra fakes (mirrors direct-delivery.spec.ts / escrow.service.spec.ts) ---------------
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
  async initCollection() { return { txRef: `tx-${Math.random().toString(36).slice(2)}`, link: 'https://pay.example/x' }; }
  async verifyTransaction(): Promise<VerifiedTxn> { return { status: 'successful', amountMinor: 0, currency: 'NGN', txRef: '', transactionId: '' }; }
  async transfer() { this.transferCalls++; return { providerRef: `t_${this.transferCalls}` }; }
  async refund() { this.refundCalls++; return { providerRef: `r_${this.refundCalls}` }; }
  async resolveAccount() { return { accountName: 'Test' }; }
  async getTransfer() { return { status: 'SUCCESSFUL' }; }
  verifyWebhookSignature() { return true; }
}

const RIDER = { bankCode: '058', accountNumber: '0123456789' };
const RIDER_ID = 'rider-1';
const QUOTE_SECRET = 'test-quote-secret-value-1234567890';
// A 3-drop route: pickup -> dropoff (stop 1) -> STOP_A (stop 2) -> STOP_B (stop 3). Each leg > MIN.
const PICKUP = { lat: 6.50, lng: 3.30 };
const DROPOFF = { lat: 6.51, lng: 3.31 };
const STOP_A = { lat: 6.52, lng: 3.32 };
const STOP_B = { lat: 6.53, lng: 3.33 };

function build() {
  const env = {
    DELIVERY_MODE: 'direct',
    JOBS_QUOTE_SECRET: QUOTE_SECRET,
    HASH_PEPPER: 'test-pepper-value-abcdef, multi-stop',
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
    env, repo,
    payout as unknown as never, limiter as unknown as never, escrow,
    notify as unknown as never, presence as unknown as never, documents as unknown as never,
    ratings as unknown as never, settings as unknown as never, riderAccount as unknown as never,
    customerEmail as unknown as never, customerPhoto as unknown as never, contact as unknown as never,
    statusLog as unknown as never, calls as unknown as never,
  );
  return { svc, repo, ledger, provider };
}

/** Book + fund a 2-extra-stop (3-drop) delivery for a fresh customer, returning the created job. */
async function bookMultiStop(svc: JobsService, customer: string) {
  const quote = svc.quote({ type: 'DELIVERY', pickup: PICKUP, dropoff: DROPOFF, stops: [STOP_A, STOP_B] });
  const created = await svc.createJob(customer, {
    quoteToken: quote.quoteToken,
    recipient: { name: 'Ada', phone: '08030000001' },
    item: 'Docs',
    extraStops: [
      { recipient: { name: 'Bola', phone: '08030000002' }, item: 'Book' },
      { recipient: { name: 'Chidi', phone: '08030000003' }, item: 'Keys' },
    ],
  } as never);
  const verified: VerifiedTxn = {
    status: 'successful', amountMinor: created.amountMinor, currency: 'NGN',
    txRef: created.flwTxRef!, transactionId: `txn-${customer}`,
  };
  await svc.confirmFundedByTxRef(verified);
  return created;
}

// -- FARE ------------------------------------------------------------------------------------------
test('FARE: a 3-drop route costs strictly more than the same first leg alone, and rows sum', () => {
  const firstLeg = haversineMeters(PICKUP, DROPOFF);
  const full = routeDistanceMeters([PICKUP, DROPOFF, STOP_A, STOP_B]);
  assert.ok(full > firstLeg, 'the full multi-leg route is longer than the first leg');

  const oneStop = computeFare('DELIVERY', firstLeg);
  const threeStop = computeFare('DELIVERY', full);
  assert.ok(threeStop.totalMinor > oneStop.totalMinor, 'a 3-drop job costs more than a single leg');

  // Rows sum to the total (base folds any minimum-fare floor), for the multi-leg total too.
  assert.equal(
    threeStop.baseMinor + threeStop.distanceMinor + threeStop.timeMinor + threeStop.platformFeeMinor,
    threeStop.totalMinor,
  );
  // The multi-leg distance is exactly the sum of the individual legs.
  assert.equal(
    full,
    haversineMeters(PICKUP, DROPOFF) + haversineMeters(DROPOFF, STOP_A) + haversineMeters(STOP_A, STOP_B),
  );
});

// -- CREATE ----------------------------------------------------------------------------------------
test('CREATE: stores N extra stops PENDING with N distinct codes, priced for the full route', async () => {
  const { svc, repo } = build();
  const fullFare = computeFare('DELIVERY', routeDistanceMeters([PICKUP, DROPOFF, STOP_A, STOP_B]));
  const created = await bookMultiStop(svc, 'cust-create');

  // Priced for the whole multi-leg path (tamper-guard recomputed the same total on createJob).
  assert.equal(created.amountMinor, fullFare.totalMinor);

  // Two extra stops, both PENDING, each with its own recipient.
  const stored = (await repo.find(created.id))!;
  assert.equal(stored.extraStops?.length, 2);
  assert.ok(stored.extraStops!.every((s) => s.status === 'PENDING'));
  assert.equal(stored.extraStops![0]!.recipient?.name, 'Bola');
  assert.equal(stored.extraStops![1]!.recipient?.name, 'Chidi');

  // N distinct plaintext codes handed to the booking customer; NONE stored in plaintext.
  assert.equal(created.extraStopCodes?.length, 2);
  assert.notEqual(created.extraStopCodes![0], created.extraStopCodes![1]);
  // The stored stops carry only a hash, and the response job never leaks it.
  assert.ok(stored.extraStops!.every((s) => typeof s.codeHash === 'string' && s.codeHash!.length > 0));
  assert.ok((created.extraStops ?? []).every((s) => s.codeHash === undefined));
});

test('CREATE tamper-guard: a token whose signed total is the single-leg price (not multi-leg) is rejected', async () => {
  const { svc } = build();
  const singleLegFare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF));
  // Forge a token that carries the extra stops but the CHEAP single-leg amount — same secret, so the
  // signature is valid, but createJob recomputes the multi-leg total and must reject the mismatch.
  const forged = signQuote({
    type: 'DELIVERY', amountMinor: singleLegFare.totalMinor, currency: 'NGN',
    pickup: PICKUP, dropoff: DROPOFF, stops: [STOP_A, STOP_B], exp: Date.now() + 60_000,
  }, QUOTE_SECRET);
  await assert.rejects(
    () => svc.createJob('cust-tamper', { quoteToken: forged, extraStops: [{}, {}] } as never),
    (e: unknown) => e instanceof BadRequestException,
  );
});

// -- MONEY-SAFETY ----------------------------------------------------------------------------------
async function driveToPrimaryDrop(svc: JobsService, jobId: string) {
  await svc.accept(RIDER_ID, jobId);
  await svc.advance(RIDER_ID, jobId, 'EN_ROUTE_PICKUP');
  await svc.arriveAtPickup(RIDER_ID, jobId, PICKUP, 0);
  await svc.advance(RIDER_ID, jobId, 'IN_PROGRESS');
  await svc.advance(RIDER_ID, jobId, 'EN_ROUTE_DROP');
  await svc.markArrived(RIDER_ID, jobId, DROPOFF, 0);
}

test('MONEY: primary + non-final stops release NOTHING; only the final stop releases, once, fare-minus-fee', async () => {
  const { svc, repo, ledger, provider } = build();
  const fare = computeFare('DELIVERY', routeDistanceMeters([PICKUP, DROPOFF, STOP_A, STOP_B]));
  const created = await bookMultiStop(svc, 'cust-money');
  await driveToPrimaryDrop(svc, created.id);

  // Primary drop-off delivered -> EN_ROUTE_STOP, and NOTHING released.
  assert.equal((await svc.completeDelivery(RIDER_ID, created.id)).status, 'EN_ROUTE_STOP');
  assert.equal((await repo.find(created.id))!.status, 'EN_ROUTE_STOP');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0, 'no release on the primary drop');
  assert.equal(provider.transferCalls, 0);

  // First EXTRA stop delivered -> still EN_ROUTE_STOP, still NOTHING released.
  assert.equal((await svc.confirmStop(RIDER_ID, created.id, 0, created.extraStopCodes![0]!, STOP_A, 0)).status, 'EN_ROUTE_STOP');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0, 'no release on a middle stop');
  assert.equal(provider.transferCalls, 0);

  // FINAL stop delivered -> RELEASED, exactly fare-minus-fee, paid once.
  assert.equal((await svc.confirmStop(RIDER_ID, created.id, 1, created.extraStopCodes![1]!, STOP_B, 0)).status, 'RELEASED');
  assert.equal((await repo.find(created.id))!.status, 'RELEASED');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, fare.totalMinor - fare.platformFeeMinor);
  assert.equal(deriveBalance(ledger.entries, 'PLATFORM_FEE').amount, fare.platformFeeMinor);
  assert.equal(deriveBalance(ledger.entries, 'CUSTOMER_REFUND').amount, 0);
  assert.equal(deriveBalance(ledger.entries, 'ESCROW').amount, 0, 'escrow fully drained');
  assert.equal(provider.transferCalls, 1, 'rider paid exactly once for the whole multi-stop job');
});

test('MONEY: a wrong code for a stop does NOT deliver it and releases nothing', async () => {
  const { svc, repo, ledger, provider } = build();
  const created = await bookMultiStop(svc, 'cust-wrong');
  await driveToPrimaryDrop(svc, created.id);
  await svc.completeDelivery(RIDER_ID, created.id); // -> EN_ROUTE_STOP

  await assert.rejects(
    () => svc.confirmStop(RIDER_ID, created.id, 0, '0000', STOP_A, 0),
    (e: unknown) => e instanceof UnauthorizedException,
  );
  const stored = (await repo.find(created.id))!;
  assert.equal(stored.extraStops![0]!.status, 'PENDING', 'wrong code left the stop undelivered');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0);
  assert.equal(provider.transferCalls, 0);
});

test('MONEY: stops must be confirmed IN ORDER — the last stop cannot jump ahead of an earlier one', async () => {
  const { svc, ledger } = build();
  const created = await bookMultiStop(svc, 'cust-order');
  await driveToPrimaryDrop(svc, created.id);
  await svc.completeDelivery(RIDER_ID, created.id); // -> EN_ROUTE_STOP

  // Try to confirm the FINAL stop (index 1) before the first extra stop (index 0): rejected, no money.
  await assert.rejects(() => svc.confirmStop(RIDER_ID, created.id, 1, created.extraStopCodes![1]!, STOP_B, 0));
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, 0);
});

test('CODE REVEAL: the customer can re-reveal a stop code, and the old booking code stops working', async () => {
  const { svc } = build();
  const created = await bookMultiStop(svc, 'cust-reveal');
  await driveToPrimaryDrop(svc, created.id);
  await svc.completeDelivery(RIDER_ID, created.id); // -> EN_ROUTE_STOP

  const oldCode = created.extraStopCodes![0]!;
  const { code: newCode } = await svc.issueStopCode('cust-reveal', created.id, 0);
  assert.notEqual(newCode, oldCode, 're-reveal mints a FRESH code');

  // Single-use is preserved on re-issue: the old booking code no longer confirms the stop.
  await assert.rejects(
    () => svc.confirmStop(RIDER_ID, created.id, 0, oldCode, STOP_A, 0),
    (e: unknown) => e instanceof UnauthorizedException,
  );
  // The freshly revealed code does confirm it.
  assert.equal((await svc.confirmStop(RIDER_ID, created.id, 0, newCode, STOP_A, 0)).status, 'EN_ROUTE_STOP');
});

test('CODE REVEAL: only the booking customer may reveal a stop code', async () => {
  const { svc } = build();
  const created = await bookMultiStop(svc, 'cust-owner');
  await assert.rejects(() => svc.issueStopCode('someone-else', created.id, 0));
});

test('MONEY (regression): a single-stop job is UNCHANGED — the one code releases immediately', async () => {
  const { svc, repo, ledger, provider } = build();
  const fare = computeFare('DELIVERY', haversineMeters(PICKUP, DROPOFF));
  const quote = svc.quote({ type: 'DELIVERY', pickup: PICKUP, dropoff: DROPOFF }); // no stops
  const created = await svc.createJob('cust-single', {
    quoteToken: quote.quoteToken, recipient: { name: 'Ada', phone: '08030000000' }, item: 'Docs',
  } as never);
  assert.equal(created.extraStopCodes, undefined, 'single-stop booking has no extra-stop codes');
  assert.equal(created.amountMinor, fare.totalMinor);
  const verified: VerifiedTxn = { status: 'successful', amountMinor: created.amountMinor, currency: 'NGN', txRef: created.flwTxRef!, transactionId: 'txn-single' };
  await svc.confirmFundedByTxRef(verified);
  await driveToPrimaryDrop(svc, created.id);

  assert.equal((await svc.completeDelivery(RIDER_ID, created.id)).status, 'RELEASED');
  assert.equal((await repo.find(created.id))!.status, 'RELEASED');
  assert.equal(deriveBalance(ledger.entries, 'RIDER_PAYABLE').amount, fare.totalMinor - fare.platformFeeMinor);
  assert.equal(provider.transferCalls, 1);
});

// -- STATE MACHINE ---------------------------------------------------------------------------------
test('STATE MACHINE: the multi-stop tail transitions are gated correctly', () => {
  assert.ok(canTransition('ARRIVED', 'EN_ROUTE_STOP'), 'primary drop moves to the multi-stop tail');
  assert.ok(canTransition('EN_ROUTE_STOP', 'COMPLETED'), 'the final stop completes the job');
  assert.ok(!canTransition('EN_ROUTE_STOP', 'RELEASED'), 'release is only reachable via COMPLETED (money guard)');
  assert.ok(canTransition('EN_ROUTE_STOP', 'DISPUTED'), 'a multi-stop job can still be disputed');
});
