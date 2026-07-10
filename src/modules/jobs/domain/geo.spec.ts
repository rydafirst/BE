import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters } from './geo.js';

test('zero distance for identical points', () => {
  assert.equal(haversineMeters({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 }), 0);
});

test('is symmetric and positive for distinct points', () => {
  const a = { lat: 6.45, lng: 3.39 }, b = { lat: 6.6, lng: 3.35 };
  const d1 = haversineMeters(a, b), d2 = haversineMeters(b, a);
  assert.equal(d1, d2);
  assert.ok(d1 > 0);
});
