import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, fareToMoney, FARE_CONFIG } from './fare.js';

test('computes a deterministic delivery fare (4km, ~10 min ETA)', () => {
  const b = computeFare('DELIVERY', 4000);
  assert.equal(b.baseMinor, 50_000);       // ₦500 base
  assert.equal(b.distanceMinor, 68_000);   // 4km × ₦170
  assert.equal(b.timeMinor, 20_000);       // ~10 min × ₦20 (ETA at 24km/h)
  assert.equal(b.platformFeeMinor, 13_800); // 10% of 138,000 subtotal
  assert.equal(b.totalMinor, 151_800);
  assert.equal(fareToMoney(b).amount, 151_800);
});

test('breakdown rows always sum to the total (base + distance + time + fee)', () => {
  for (const m of [0, 500, 2000, 5000, 12000]) {
    const b = computeFare('DELIVERY', m);
    assert.equal(b.baseMinor + b.distanceMinor + b.timeMinor + b.platformFeeMinor, b.totalMinor);
  }
});

test('a short trip is floored to the minimum fare', () => {
  const b = computeFare('DELIVERY', 500); // 0.5km, tiny — below the ₦900 floor
  const subtotal = b.baseMinor + b.distanceMinor + b.timeMinor;
  assert.equal(subtotal, FARE_CONFIG.minimumMinor.DELIVERY); // rider nets exactly the ₦900 floor
});

test('time affects price — a longer duration costs more', () => {
  const quick = computeFare('DELIVERY', 4000, 10);
  const slow = computeFare('DELIVERY', 4000, 30); // same distance, more time in traffic
  assert.ok(slow.timeMinor > quick.timeMinor);
  assert.ok(slow.totalMinor > quick.totalMinor);
  assert.equal(slow.timeMinor, 30 * FARE_CONFIG.perMinuteMinor);
});

test('a ~5km delivery nets the rider ₦1,500–₦2,000 (launch target)', () => {
  const b = computeFare('DELIVERY', 5000);
  const riderNet = b.baseMinor + b.distanceMinor + b.timeMinor; // subtotal, before platform fee
  assert.ok(riderNet >= 150_000 && riderNet <= 200_000, `riderNet=${riderNet}`);
});

test('ride base is higher than delivery', () => {
  assert.ok(computeFare('RIDE', 0).baseMinor > computeFare('DELIVERY', 0).baseMinor);
});

test('rejects negative distance', () => {
  assert.throws(() => computeFare('DELIVERY', -5));
});

test('rejects a negative explicit duration', () => {
  assert.throws(() => computeFare('DELIVERY', 4000, -1));
});
