import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedAttemptFee, BASE_FAILED_ATTEMPT_FEE_MINOR } from './failed-attempt-fee.js';

const COLLECTED = 500_000; // ₦5,000 held — well above any fee
const NOW = 2_000_000_000_000;
const mins = (m: number) => NOW - m * 60_000; // an arrival m minutes ago

test('RETURN policy: base fee only, no waiting', () => {
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'RETURN', arrivedAtMs: mins(30), nowMs: NOW });
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR);
  assert.equal(f.waitingMinor, 0);
});

test('DELEGATE policy: base fee only, no waiting', () => {
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'DELEGATE', arrivedAtMs: mins(30), nowMs: NOW });
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR);
  assert.equal(f.waitingMinor, 0);
});

test('WAIT policy with no arrival recorded: base fee only', () => {
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'WAIT', nowMs: NOW });
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR);
  assert.equal(f.waitingMinor, 0);
});

test('WAIT within the 10-min grace: no waiting fee', () => {
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'WAIT', arrivedAtMs: mins(5), nowMs: NOW });
  assert.equal(f.waitingMinor, 0);
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR);
});

test('WAIT past grace: metered ₦50/min waiting fee added', () => {
  // 25 min at drop-off => 15 min beyond the 10-min grace => 15 * ₦50 = ₦750 waiting
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'WAIT', arrivedAtMs: mins(25), nowMs: NOW });
  assert.equal(f.waitingMinor, 75_000);
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR + 75_000);
});

test('waiting fee is capped at ₦1,000 for long waits', () => {
  const f = failedAttemptFee({ collectedMinor: COLLECTED, policy: 'WAIT', arrivedAtMs: mins(600), nowMs: NOW });
  assert.equal(f.waitingMinor, 100_000); // ₦1,000 cap
  assert.equal(f.totalMinor, BASE_FAILED_ATTEMPT_FEE_MINOR + 100_000);
});

test('INVARIANT: total never exceeds what was collected (tiny order, base alone caps)', () => {
  const collected = 30_000; // ₦300 held — below the ₦500 base fee
  const f = failedAttemptFee({ collectedMinor: collected, policy: 'WAIT', arrivedAtMs: mins(25), nowMs: NOW });
  assert.equal(f.totalMinor, collected);           // capped at collected
  assert.equal(f.baseMinor, collected);            // base alone already hits the cap
  assert.equal(f.waitingMinor, 0);                 // nothing left for waiting
  assert.ok(f.totalMinor <= collected);
});

test('INVARIANT: base + partial waiting still capped at collected', () => {
  const collected = 70_000; // room for base (₦500) + ₦200 of waiting
  const f = failedAttemptFee({ collectedMinor: collected, policy: 'WAIT', arrivedAtMs: mins(25), nowMs: NOW });
  assert.equal(f.totalMinor, collected);
  assert.equal(f.baseMinor, BASE_FAILED_ATTEMPT_FEE_MINOR);
  assert.equal(f.waitingMinor, collected - BASE_FAILED_ATTEMPT_FEE_MINOR);
  assert.equal(f.baseMinor + f.waitingMinor, f.totalMinor);
});
