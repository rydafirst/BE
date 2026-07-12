import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReleaseJob } from './rider-release.js';
import { canTransition, type JobStatus } from './job-state-machine.js';

test('a job can be released back to the pool only before pickup', () => {
  for (const s of ['ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP'] as JobStatus[]) {
    assert.equal(canReleaseJob(s), true, `${s} should be releasable`);
  }
});

test('a job cannot be released once picked up or in any other state', () => {
  for (const s of ['IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'COMPLETED', 'RELEASED', 'CANCELLED', 'SEARCHING', 'FUNDED', 'CREATED'] as JobStatus[]) {
    assert.equal(canReleaseJob(s), false, `${s} should NOT be releasable`);
  }
});

test('the state machine allows the release transition back to SEARCHING before pickup', () => {
  assert.equal(canTransition('ACCEPTED', 'SEARCHING'), true);
  assert.equal(canTransition('EN_ROUTE_PICKUP', 'SEARCHING'), true);
  assert.equal(canTransition('AT_PICKUP', 'SEARCHING'), true);
  // never after pickup
  assert.equal(canTransition('IN_PROGRESS', 'SEARCHING'), false);
});
