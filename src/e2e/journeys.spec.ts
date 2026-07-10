/**
 * End-to-end money-invariant journeys. These compose the real domain pieces
 * (state machine + escrow postings + settlement) through a whole job lifecycle and assert:
 *   - every transition taken is legal,
 *   - the ledger stays balanced at every step,
 *   - escrow always nets to zero after settlement,
 *   - rider + customer shares reconcile to exactly what was collected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from '../modules/payments/domain/money.js';
import { computeSettlement, type SettlementOutcome } from '../modules/payments/domain/refund.js';
import { buildHoldPosting, buildSettlementPosting } from '../modules/payments/domain/escrow-posting.js';
import { assertBalanced, deriveBalance, type LedgerEntry } from '../modules/payments/domain/ledger.js';
import { assertTransition, canRelease, canRefund, type JobStatus } from '../modules/jobs/domain/job-state-machine.js';

const JOB = 'job-e2e';
const collected = Money.of(85_800); // ₦858.00

/** Walk a path of statuses, asserting each transition is legal. */
function walk(path: readonly JobStatus[]): void {
  for (let i = 1; i < path.length; i++) assertTransition(path[i - 1]!, path[i]!);
}

/** Post hold + settlement and assert the end-to-end money invariants. */
function settleAndAssert(outcome: SettlementOutcome, extra: { attemptFee?: Money; riderShare?: Money } = {}) {
  const settlement = computeSettlement({ collected, outcome, ...extra });
  const ledger: LedgerEntry[] = [
    ...buildHoldPosting(JOB, collected),
    ...buildSettlementPosting(JOB, settlement),
  ];
  // Each transaction was individually balanced; the whole journey nets escrow to zero.
  assert.doesNotThrow(() => assertBalanced(buildHoldPosting(JOB, collected)));
  assert.doesNotThrow(() => assertBalanced(buildSettlementPosting(JOB, settlement)));
  assert.equal(deriveBalance(ledger, 'ESCROW').amount, 0);
  assert.equal(
    deriveBalance(ledger, 'RIDER_PAYABLE').amount + deriveBalance(ledger, 'CUSTOMER_REFUND').amount,
    collected.amount,
  );
  return settlement;
}

test('JOURNEY: delivery happy path -> full release to rider', () => {
  walk(['CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
        'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'COMPLETED', 'RELEASED']);
  assert.equal(canRelease('COMPLETED'), true);
  const s = settleAndAssert('RELEASE_FULL');
  assert.equal(s.toRider.amount, collected.amount);
  assert.equal(s.toCustomer.amount, 0);
});

test('JOURNEY: unavailable receiver -> failed attempt fee + refund', () => {
  walk(['CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
        'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'FAILED_ATTEMPT']);
  assert.equal(canRefund('FAILED_ATTEMPT'), true);
  const s = settleAndAssert('FAILED_ATTEMPT', { attemptFee: Money.of(50_000) });
  assert.equal(s.toRider.amount, 50_000);
  assert.equal(s.toCustomer.amount, collected.amount - 50_000);
});

test('JOURNEY: cancel before pickup -> full refund', () => {
  walk(['CREATED', 'FUNDED', 'SEARCHING', 'CANCELLED']);
  assert.equal(canRefund('CANCELLED'), true);
  const s = settleAndAssert('REFUND_FULL');
  assert.equal(s.toRider.amount, 0);
  assert.equal(s.toCustomer.amount, collected.amount);
});

test('JOURNEY: dispute -> adjudicated split reconciles', () => {
  walk(['CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
        'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'DISPUTED', 'DISPUTE_RESOLVED']);
  const s = settleAndAssert('DISPUTE_SPLIT', { riderShare: Money.of(40_000) });
  assert.equal(s.toRider.amount, 40_000);
  assert.equal(s.toRider.amount + s.toCustomer.amount, collected.amount);
});

test('JOURNEY GUARD: illegal jump (SEARCHING -> RELEASED) is rejected', () => {
  assert.throws(() => walk(['SEARCHING', 'RELEASED']));
});
