import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, fareToMoney, FARE_CONFIG } from './fare.js';

test('computes a deterministic delivery fare (4km straight-line ≈ 5.6km road, ~22 min ETA)', () => {
  const b = computeFare('DELIVERY', 4000);
  assert.equal(b.baseMinor, 70_000);        // ₦700 base
  assert.equal(b.distanceMinor, 123_200);   // 5.6 road-km × ₦220
  assert.equal(b.timeMinor, 44_000);        // ~22 min × ₦20 (ETA at 15km/h on road distance)
  assert.equal(b.platformFeeMinor, 23_720); // 10% of 237,200 subtotal
  assert.equal(b.totalMinor, 260_920);
  assert.equal(fareToMoney(b).amount, 260_920);
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

test('a ~5km delivery nets the rider about ₦2,800 (retuned target, vs the Lagos bike-dispatch market)', () => {
  const b = computeFare('DELIVERY', 5000);
  const riderNet = b.baseMinor + b.distanceMinor + b.timeMinor; // subtotal, before platform fee
  assert.equal(riderNet, 280_000, `riderNet=${riderNet}`);       // ₦700 + 7 road-km×₦220 + 28 min×₦20
  assert.ok(riderNet >= 270_000 && riderNet <= 300_000);
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
