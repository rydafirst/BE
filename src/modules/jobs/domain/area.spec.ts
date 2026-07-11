import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coarseArea } from './area.js';

test('reduces a full street address to locality + state, dropping the country', () => {
  assert.equal(coarseArea('12 Allen Avenue, Ikeja, Lagos, Nigeria'), 'Ikeja, Lagos');
});

test('leaves an already-coarse area unchanged', () => {
  assert.equal(coarseArea('Ikeja, Lagos'), 'Ikeja, Lagos');
});

test('handles a single-part label', () => {
  assert.equal(coarseArea('Lagos'), 'Lagos');
  assert.equal(coarseArea('Lagos, Nigeria'), 'Lagos');
});

test('returns empty for missing address (older orders)', () => {
  assert.equal(coarseArea(undefined), '');
  assert.equal(coarseArea(''), '');
  assert.equal(coarseArea('   '), '');
});
