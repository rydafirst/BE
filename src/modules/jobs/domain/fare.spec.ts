import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, fareToMoney, FARE_CONFIG } from './fare.js';

test('computes a deterministic DISTANCE-ONLY delivery fare (4km straight-line ≈ 5.6km road)', () => {
  const b = computeFare('DELIVERY', 4000);
  assert.equal(b.baseMinor, 70_000);        // ₦700 base
  assert.equal(b.distanceMinor, 123_200);   // 5.6 road-km × ₦220
  assert.equal(b.timeMinor, 0);             // time charge dropped — distance-only pricing
  assert.equal(b.platformFeeMinor, 19_320); // 10% of 193,200 subtotal
  assert.equal(b.totalMinor, 212_520);
  assert.equal(fareToMoney(b).amount, 212_520);
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

test('time does NOT affect price — distance-only pricing is predictable (same distance = same fare)', () => {
  const quick = computeFare('DELIVERY', 4000, 10);
  const slow = computeFare('DELIVERY', 4000, 30); // same distance, more time in traffic
  assert.equal(slow.timeMinor, 0);
  assert.equal(quick.timeMinor, 0);
  assert.equal(slow.totalMinor, quick.totalMinor); // identical — route/traffic no longer swings the price
});

test('a ~5km delivery nets the rider ₦2,240 (distance-only: ₦700 + 7 road-km × ₦220)', () => {
  const b = computeFare('DELIVERY', 5000);
  const riderNet = b.baseMinor + b.distanceMinor + b.timeMinor; // subtotal, before platform fee
  assert.equal(riderNet, 224_000, `riderNet=${riderNet}`);       // ₦700 + 7 road-km×₦220, no time charge
});

test('economy tier discounts the fare and the rider payout, and rows still sum', () => {
  const express = computeFare('DELIVERY', 4000);          // no discount
  const economy = computeFare('DELIVERY', 4000, undefined, 20); // 20% off
  assert.equal(express.discountMinor, 0);
  assert.ok(economy.discountMinor < 0, 'economy carries a negative discount row');
  // 20% off the 193,200 subtotal = -38,640; net subtotal 154,560; fee 10% = 15,456; total 170,016.
  assert.equal(economy.discountMinor, -38_640);
  assert.equal(economy.totalMinor, 170_016);
  assert.ok(economy.totalMinor < express.totalMinor, 'economy is cheaper for the customer');
  // Rider nets the discounted subtotal → paid less than express.
  const expressNet = express.baseMinor + express.distanceMinor + express.timeMinor + express.discountMinor;
  const economyNet = economy.baseMinor + economy.distanceMinor + economy.timeMinor + economy.discountMinor;
  assert.ok(economyNet < expressNet, 'rider is paid less on economy');
  // Rows sum including the discount row.
  assert.equal(economy.baseMinor + economy.distanceMinor + economy.timeMinor + economy.discountMinor + economy.platformFeeMinor, economy.totalMinor);
});

test('rejects an out-of-range discount', () => {
  assert.throws(() => computeFare('DELIVERY', 4000, undefined, 120));
  assert.throws(() => computeFare('DELIVERY', 4000, undefined, -5));
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
