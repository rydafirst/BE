import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinGeofence, checkArrival, MAX_GPS_SLACK_M } from './geofence.js';
import { haversineMeters } from '../../jobs/domain/geo.js';

test('rider at the drop is within the geofence', () => {
  assert.equal(isWithinGeofence({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 }), true);
});
test('rider far away is rejected (no fake "nobody home")', () => {
  assert.equal(isWithinGeofence({ lat: 6.5, lng: 3.3 }, { lat: 6.7, lng: 3.5 }), false);
});

// A point ~140m north of the target (0.00126 deg lat ≈ 140m).
const target = { lat: 6.5, lng: 3.3 };
const drift = { lat: 6.5 + 0.00126, lng: 3.3 };

test('checkArrival reports the measured distance', () => {
  const r = checkArrival(drift, target, 120, 0);
  assert.equal(r.distanceMeters, haversineMeters(drift, target));
  assert.ok(r.distanceMeters > 120 && r.distanceMeters < 160);
});

test('a rider just outside a tight radius is rejected with no GPS slack', () => {
  const r = checkArrival(drift, target, 120, 0);
  assert.equal(r.ok, false);
  assert.equal(r.allowedMeters, 120);
});

test('a poor GPS fix widens the allowed radius so a rider at the point is not blocked', () => {
  // Same ~140m drift, but the phone reports 100m accuracy -> allowed 220m -> accepted.
  const r = checkArrival(drift, target, 120, 100);
  assert.equal(r.ok, true);
  assert.equal(r.allowedMeters, 220);
});

test('GPS slack is capped so a spoofed huge accuracy cannot defeat the fence', () => {
  const r = checkArrival({ lat: 6.7, lng: 3.5 }, target, 120, 999999); // ~28km away
  assert.equal(r.allowedMeters, 120 + MAX_GPS_SLACK_M); // slack capped
  assert.equal(r.ok, false);
});
