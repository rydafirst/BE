import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaMinutes, distanceKm, AVG_CITY_KMH } from './eta.js';

test('eta scales with distance and floors at 1 minute', () => {
  // 24 km at 24 km/h = 60 min.
  assert.equal(etaMinutes(24_000), 60);
  // 2 km -> ~5 min.
  assert.equal(etaMinutes(2_000), 5);
  // Tiny distance still reads as at least 1 minute (never "0 min away").
  assert.equal(etaMinutes(10), 1);
});

test('eta honours a custom average speed and rejects bad input', () => {
  assert.equal(etaMinutes(10_000, 60), 10); // 10km at 60km/h = 10 min
  assert.throws(() => etaMinutes(-1));
  assert.throws(() => etaMinutes(1_000, 0));
  assert.ok(AVG_CITY_KMH > 0);
});

test('distanceKm rounds to one decimal', () => {
  assert.equal(distanceKm(2_449), 2.4);
  assert.equal(distanceKm(0), 0);
  assert.equal(distanceKm(940), 0.9);
  assert.equal(distanceKm(950), 1); // 0.95 km rounds up to 1.0
});
