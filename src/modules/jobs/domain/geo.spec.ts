import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters, isTripTooShort, MIN_TRIP_METERS } from './geo.js';

test('zero distance for identical points', () => {
  assert.equal(haversineMeters({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 }), 0);
});

test('is symmetric and positive for distinct points', () => {
  const a = { lat: 6.45, lng: 3.39 }, b = { lat: 6.6, lng: 3.35 };
  const d1 = haversineMeters(a, b), d2 = haversineMeters(b, a);
  assert.equal(d1, d2);
  assert.ok(d1 > 0);
});

test('flags identical pickup and drop-off as too short', () => {
  const p = { lat: 6.5244, lng: 3.3792 };
  assert.ok(isTripTooShort(p, p));
});

test('tolerates GPS drift just under the threshold but allows a real trip', () => {
  const p = { lat: 6.5244, lng: 3.3792 };
  // ~10m north — still "same place", must be rejected.
  const drift = { lat: 6.5244 + 0.00009, lng: 3.3792 };
  assert.ok(haversineMeters(p, drift) < MIN_TRIP_METERS);
  assert.ok(isTripTooShort(p, drift));
  // ~1km away — a genuine delivery, must be allowed.
  const real = { lat: 6.5334, lng: 3.3792 };
  assert.ok(haversineMeters(p, real) >= MIN_TRIP_METERS);
  assert.equal(isTripTooShort(p, real), false);
});
