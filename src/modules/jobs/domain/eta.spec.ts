import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaMinutes, distanceKm, roadMeters, AVG_CITY_KMH, ROAD_DISTANCE_FACTOR } from './eta.js';

test('eta scales straight-line distance to road distance, then the 15 km/h city average', () => {
  // 24 km straight-line -> 33.6 km road at 15 km/h = ~134 min.
  assert.equal(etaMinutes(24_000), 134);
  // 2 km straight-line -> 2.8 km road -> ~11 min (was far too short at the old 24 km/h straight-line).
  assert.equal(etaMinutes(2_000), 11);
  // Tiny distance still reads as at least 1 minute (never "0 min away").
  assert.equal(etaMinutes(10), 1);
});

test('eta honours a custom average speed and rejects bad input', () => {
  assert.equal(etaMinutes(10_000, 60), 14); // 10km straight -> 14km road at 60km/h = 14 min
  assert.throws(() => etaMinutes(-1));
  assert.throws(() => etaMinutes(1_000, 0));
  assert.ok(AVG_CITY_KMH > 0);
});

test('roadMeters applies the road-distance factor', () => {
  assert.equal(roadMeters(1_000), 1_000 * ROAD_DISTANCE_FACTOR);
  assert.throws(() => roadMeters(-1));
});

test('distanceKm rounds to one decimal', () => {
  assert.equal(distanceKm(2_449), 2.4);
  assert.equal(distanceKm(0), 0);
  assert.equal(distanceKm(940), 0.9);
  assert.equal(distanceKm(950), 1); // 0.95 km rounds up to 1.0
});
