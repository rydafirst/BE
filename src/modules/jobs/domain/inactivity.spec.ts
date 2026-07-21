/**
 * The inactivity rules decide when to interrupt a rider who is working. Over-firing is the real
 * risk: a rider who learns the app nags them for things that are not their move will start ignoring
 * it, which also costs us the notifications that matter. So the tests pin the exclusions as firmly
 * as the thresholds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStalled, reminderKey, stallReminder, watchedStages } from './inactivity.js';
import type { JobStatus } from './job-state-machine.js';

const MIN = 60_000;

test('fires only once the stage threshold is reached', () => {
  assert.equal(isStalled('IN_PROGRESS', 4 * MIN), false);
  assert.equal(isStalled('IN_PROGRESS', 5 * MIN), true);
  assert.equal(isStalled('EN_ROUTE_PICKUP', 29 * MIN), false);
  assert.equal(isStalled('EN_ROUTE_PICKUP', 30 * MIN), true);
});

test('never nudges a rider who is deliberately waiting — they are being paid to stand still', () => {
  assert.equal(isStalled('WAITING', 60 * MIN), false);
});

test('never nudges the rider when the move belongs to someone else', () => {
  // Sender must choose keep-waiting or return; nothing the rider can do.
  assert.equal(isStalled('AWAITING_RESOLUTION', 60 * MIN), false);
  // Nobody is assigned yet.
  for (const s of ['CREATED', 'FUNDED', 'SEARCHING'] as JobStatus[]) {
    assert.equal(isStalled(s, 60 * MIN), false, `${s} has no rider to nudge`);
  }
});

test('never nudges on a finished or disputed job', () => {
  for (const s of ['COMPLETED', 'RELEASED', 'CANCELLED', 'FAILED_ATTEMPT', 'DISPUTED', 'DISPUTE_RESOLVED'] as JobStatus[]) {
    assert.equal(isStalled(s, 24 * 60 * MIN), false, `${s} must not nudge`);
  }
});

test('every watched stage has a message, and only watched stages do', () => {
  for (const s of watchedStages()) {
    assert.ok(stallReminder(s), `${s} is watched but has nothing to say`);
    assert.ok(isStalled(s, 24 * 60 * MIN), `${s} is watched but never fires`);
  }
  for (const s of ['WAITING', 'AWAITING_RESOLUTION', 'RELEASED'] as JobStatus[]) {
    assert.equal(stallReminder(s), null, `${s} should have no reminder`);
  }
});

test('the reminder key is stable per job and stage, so a repeated scan cannot double-send', () => {
  assert.equal(reminderKey('job-1', 'ARRIVED'), reminderKey('job-1', 'ARRIVED'));
  assert.notEqual(reminderKey('job-1', 'ARRIVED'), reminderKey('job-1', 'AT_PICKUP'));
  assert.notEqual(reminderKey('job-1', 'ARRIVED'), reminderKey('job-2', 'ARRIVED'));
});
