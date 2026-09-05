import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameMatchScore, namesMatch, normalizeName } from './name-match.js';

test('normalises: drops punctuation and generic business words', () => {
  assert.deepEqual(normalizeName('SOLASHINE VENTURES LTD.'), ['solashine']);
  assert.deepEqual(normalizeName('Sola Store'), ['sola']);
  assert.deepEqual(normalizeName('Retail Supermarkets Nig Ltd'), ['retail', 'supermarkets']);
});

test('matches a casual store name against the registered entity (prefix hit)', () => {
  assert.equal(namesMatch('Sola Store', 'SOLASHINE VENTURES LTD'), true);
  assert.equal(namesMatch('Shoprite Lekki', 'SHOPRITE NIGERIA LIMITED'), true);
});

test('rejects an unrelated account name (fraud guard: rider entering their own account)', () => {
  assert.equal(namesMatch('Sola Store', 'JOHN DOE MUSA'), false);
  assert.equal(nameMatchScore('Sola Store', 'JOHN DOE MUSA'), 0);
});

test('empty / all-stopword names never auto-match', () => {
  assert.equal(nameMatchScore('Ltd', 'Ventures Ltd'), 0);
  assert.equal(namesMatch('', 'SOLASHINE VENTURES LTD'), false);
});
