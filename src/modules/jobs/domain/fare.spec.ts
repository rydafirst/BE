import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, fareToMoney } from './fare.js';

test('computes a deterministic delivery fare (4km)', () => {
  const b = computeFare('DELIVERY', 4000);
  assert.equal(b.baseMinor, 30_000);
  assert.equal(b.distanceMinor, 48_000);
  assert.equal(b.platformFeeMinor, 7_800); // 10% of 78,000
  assert.equal(b.totalMinor, 85_800);
  assert.equal(fareToMoney(b).amount, 85_800);
});

test('ride base is higher than delivery', () => {
  assert.ok(computeFare('RIDE', 0).baseMinor > computeFare('DELIVERY', 0).baseMinor);
});

test('rejects negative distance', () => {
  assert.throws(() => computeFare('DELIVERY', -5));
});
