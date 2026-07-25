import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTransition,
  canRelease,
  canRefund,
  canTransition,
  IllegalTransitionError,
  isDeliveryComplete,
  isRiderEngaged,
  isTerminal,
  type JobStatus,
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

test('a delivery counts as complete at COMPLETED and stays complete at RELEASED', () => {
  assert.ok(isDeliveryComplete('COMPLETED'));
  assert.ok(isDeliveryComplete('RELEASED'));
});

test('no state before the drop-off counts as a complete delivery', () => {
  const notYet: JobStatus[] = [
    'CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
    'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'WAITING',
    'AWAITING_RESOLUTION', 'CANCELLED', 'FAILED_ATTEMPT',
  ];
  for (const s of notYet) assert.equal(isDeliveryComplete(s), false, `${s} must not read as complete`);
});

test('completeness is not the same as terminality — COMPLETED can still be disputed', () => {
  assert.ok(isDeliveryComplete('COMPLETED'));
  assert.equal(isTerminal('COMPLETED'), false);
  assert.ok(canTransition('COMPLETED', 'DISPUTED'));
});

test('a rider is engaged from acceptance through drop-off resolution', () => {
  const engaged: JobStatus[] = [
    'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS',
    'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION',
  ];
  for (const s of engaged) assert.ok(isRiderEngaged(s), `${s} must count as engaged`);
});

test('a rider is NOT engaged before acceptance, once done, or on an off-ramp', () => {
  // These are the states from which a rider may take a fresh job: nothing they must keep moving.
  const free: JobStatus[] = [
    'CREATED', 'FUNDED', 'SEARCHING', 'COMPLETED', 'RELEASED',
    'CANCELLED', 'FAILED_ATTEMPT', 'DISPUTED', 'DISPUTE_RESOLVED',
  ];
  for (const s of free) assert.equal(isRiderEngaged(s), false, `${s} must not block a new job`);
});

test('engaged and terminal partition every status (no gaps, no overlap)', () => {
  // Guards against a new status being added without deciding whether it engages the rider.
  const all: JobStatus[] = [
    'CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS',
    'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION', 'COMPLETED',
    'RELEASED', 'CANCELLED', 'FAILED_ATTEMPT', 'DISPUTED', 'DISPUTE_RESOLVED',
  ];
  for (const s of all) assert.equal(typeof isRiderEngaged(s), 'boolean', `${s} must be classified`);
  // A rider is never both "engaged" and "finished" in the same status.
  assert.equal(isRiderEngaged('COMPLETED'), false);
  assert.equal(isRiderEngaged('RELEASED'), false);
});
