import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinGeofence } from './geofence.js';

test('rider at the drop is within the geofence', () => {
  assert.equal(isWithinGeofence({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 }), true);
});
test('rider far away is rejected (no fake "nobody home")', () => {
  assert.equal(isWithinGeofence({ lat: 6.5, lng: 3.3 }, { lat: 6.7, lng: 3.5 }), false);
});
