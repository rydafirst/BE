import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approximatePoint } from './approx.js';

test('snaps to a ~1km grid, hiding the exact point', () => {
  const exact = { lat: 6.512345, lng: 3.378912 };
  const approx = approximatePoint(exact);
  // Rounded to the nearest 0.01°.
  assert.equal(approx.lat, 6.51);
  assert.equal(approx.lng, 3.38);
  // The exact position is not recoverable from the pin.
  assert.notEqual(approx.lat, exact.lat);
});

test('nearby exact points collapse to the same pin', () => {
  const a = approximatePoint({ lat: 6.5011, lng: 3.3799 });
  const b = approximatePoint({ lat: 6.5041, lng: 3.3801 });
  assert.deepEqual(a, b);
});
