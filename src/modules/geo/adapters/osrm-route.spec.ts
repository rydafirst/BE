/**
 * OSRM returns coordinates as [lng, lat] — the reverse of how we (and most of our code) carry them.
 * A swapped axis would put the route in the wrong hemisphere, so these tests pin the mapping and the
 * fail-closed behaviour on any malformed response.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsrmRoute } from './osrm-route.provider.js';

const ok = {
  code: 'Ok',
  routes: [{
    distance: 1234.6,
    duration: 300.4,
    geometry: { coordinates: [[3.3792, 6.5244], [3.3800, 6.5250], [3.3810, 6.5261]] as [number, number][] },
  }],
};

test('maps OSRM [lng,lat] pairs to our {lat,lng} in order', () => {
  const r = parseOsrmRoute(ok);
  assert.equal(r.points.length, 3);
  assert.deepEqual(r.points[0], { lat: 6.5244, lng: 3.3792 });
  assert.deepEqual(r.points[2], { lat: 6.5261, lng: 3.3810 });
});

test('rounds distance and duration to whole units', () => {
  const r = parseOsrmRoute(ok);
  assert.equal(r.distanceMeters, 1235);
  assert.equal(r.durationSeconds, 300);
});

test('throws when OSRM reports a non-Ok status', () => {
  assert.throws(() => parseOsrmRoute({ code: 'NoRoute', routes: [] }));
});

test('throws when there is no usable geometry', () => {
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[3.3, 6.5]] } }] }));
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [] }));
  assert.throws(() => parseOsrmRoute({}));
});

test('missing distance/duration default to zero, never NaN', () => {
  const r = parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[3.3, 6.5], [3.4, 6.6]] } }] });
  assert.equal(r.distanceMeters, 0);
  assert.equal(r.durationSeconds, 0);
});
