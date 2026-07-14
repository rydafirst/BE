import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTransition,
  canRelease,
  canRefund,
  canTransition,
  IllegalTransitionError,
  isTerminal,
} from './job-state-machine.js';

test('allows the delivery happy-path transitions', () => {
  assert.ok(canTransition('CREATED', 'FUNDED'));
  assert.ok(canTransition('ARRIVED', 'AWAITING_CODE'));
  assert.ok(canTransition('AWAITING_CODE', 'COMPLETED'));
  assert.ok(canTransition('COMPLETED', 'RELEASED'));
});

test('rejects illegal jumps (client cannot force release)', () => {
  assert.equal(canTransition('CREATED', 'RELEASED'), false);
  assert.equal(canTransition('SEARCHING', 'COMPLETED'), false);
  assert.throws(() => assertTransition('FUNDED', 'RELEASED'), IllegalTransitionError);
});

test('RELEASE is only possible from COMPLETED', () => {
  assert.ok(canRelease('COMPLETED'));
  for (const s of ['CREATED', 'FUNDED', 'ARRIVED', 'AWAITING_CODE', 'DISPUTED'] as const) {
    assert.equal(canRelease(s), false);
  }
});

test('REFUND is only possible from CANCELLED / FAILED_ATTEMPT / DISPUTE_RESOLVED', () => {
  for (const s of ['CANCELLED', 'FAILED_ATTEMPT', 'DISPUTE_RESOLVED'] as const) {
    assert.ok(canRefund(s));
  }
  for (const s of ['COMPLETED', 'RELEASED', 'ARRIVED'] as const) {
    assert.equal(canRefund(s), false);
  }
});

test('waiting + resolution path is legal; recipient-absence never auto-refunds', () => {
  // Rider starts waiting, grace expires, sender is asked to resolve.
  assert.ok(canTransition('ARRIVED', 'WAITING'));
  assert.ok(canTransition('WAITING', 'AWAITING_RESOLUTION'));
  // Sender keeps waiting (metered) or the recipient finally collects.
  assert.ok(canTransition('AWAITING_RESOLUTION', 'WAITING'));
  assert.ok(canTransition('WAITING', 'COMPLETED'));
  // Initiating a return completes the outbound (rider paid in full) — it does not refund.
  assert.ok(canTransition('AWAITING_RESOLUTION', 'COMPLETED'));
  assert.equal(canRefund('WAITING'), false);
  assert.equal(canRefund('AWAITING_RESOLUTION'), false);
  // A stalled resolution can still escalate to a dispute.
  assert.ok(canTransition('AWAITING_RESOLUTION', 'DISPUTED'));
});

test('terminal states have no outgoing transitions', () => {
  for (const s of ['RELEASED', 'CANCELLED', 'DISPUTE_RESOLVED'] as const) {
    assert.ok(isTerminal(s));
  }
});
