import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETURN_FARE_PCT, computeReturnFareMinor, accruedWaitingMinor, graceElapsed } from './resolution.js';
import { GRACE_SECONDS } from '../../confirmations/domain/fallback.js';

const MIN = 60_000;

test('return fare is 75% of the original total (half + a quarter)', () => {
  assert.equal(RETURN_FARE_PCT, 75);
  assert.equal(computeReturnFareMinor(99_000), 74_250); // ₦990 -> ₦742.50
  assert.equal(computeReturnFareMinor(0), 0);
});

test('return fare rejects non-integer / negative input (fail closed)', () => {
  assert.throws(() => computeReturnFareMinor(-1));
  assert.throws(() => computeReturnFareMinor(1.5));
});

test('the first 10 minutes are free grace — nothing accrues', () => {
  const start = 1_000_000;
  assert.equal(accruedWaitingMinor(start, start), 0);
  assert.equal(accruedWaitingMinor(start, start + 10 * MIN), 0); // exactly at grace edge
  assert.equal(graceElapsed(start, start + 9 * MIN), false);
});

test('metering starts only after grace, per minute, capped at ₦1,000', () => {
  const start = 1_000_000;
  // 1 minute past the 10-min grace => 1 minute charged @ ₦50
  assert.equal(accruedWaitingMinor(start, start + 11 * MIN), 5_000);
  // 5 minutes past grace => ₦250
  assert.equal(accruedWaitingMinor(start, start + 15 * MIN), 25_000);
  // far beyond => capped at ₦1,000
  assert.equal(accruedWaitingMinor(start, start + 200 * MIN), 100_000);
  assert.equal(graceElapsed(start, start + GRACE_SECONDS * 1000), true);
});
