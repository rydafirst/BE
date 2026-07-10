import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFallback, waitingFee, GRACE_SECONDS, MAX_WAIT_FEE_MINOR } from './fallback.js';

test('waits during the grace window', () => {
  assert.equal(decideFallback({ elapsedSeconds: 100, receiverResponded: false, delegated: false }), 'WAITING');
});
test('delegation takes precedence', () => {
  assert.equal(decideFallback({ elapsedSeconds: 9999, receiverResponded: false, delegated: true }), 'READY_DELEGATE');
});
test('failed attempt after grace with no response', () => {
  assert.equal(decideFallback({ elapsedSeconds: GRACE_SECONDS + 1, receiverResponded: false, delegated: false }), 'FAILED_ATTEMPT');
});
test('no waiting fee within grace; accrues after; capped', () => {
  assert.equal(waitingFee(GRACE_SECONDS).amount, 0);
  assert.equal(waitingFee(GRACE_SECONDS + 60).amount, 5_000);
  assert.equal(waitingFee(GRACE_SECONDS + 100_000).amount, MAX_WAIT_FEE_MINOR);
});
