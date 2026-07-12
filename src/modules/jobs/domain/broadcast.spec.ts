import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_JOB_BROADCAST, ridersToAnnounce } from './broadcast.js';

test('returns all online riders when small', () => {
  assert.deepEqual(ridersToAnnounce(['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('de-duplicates and drops empties', () => {
  assert.deepEqual(ridersToAnnounce(['a', 'a', '', 'b']), ['a', 'b']);
});

test('excludes a given rider (e.g. the one who released the job)', () => {
  assert.deepEqual(ridersToAnnounce(['a', 'b', 'c'], { exclude: 'b' }), ['a', 'c']);
});

test('caps the fan-out', () => {
  const many = Array.from({ length: MAX_JOB_BROADCAST + 50 }, (_, i) => `r${i}`);
  assert.equal(ridersToAnnounce(many).length, MAX_JOB_BROADCAST);
  assert.equal(ridersToAnnounce(many, { cap: 3 }).length, 3);
});

test('empty pool yields nothing', () => {
  assert.deepEqual(ridersToAnnounce([]), []);
});
