import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNgE164 } from './phone.js';

test('converts local 0-prefixed numbers to international 234…', () => {
  // The exact formats Termii rejected as "not dialable".
  assert.equal(toNgE164('08068080725'), '2348068080725');
  assert.equal(toNgE164('08149249926'), '2348149249926');
  assert.equal(toNgE164('0802 344 4566'), '2348023444566'); // spaces stripped too
});

test('leaves international numbers intact and strips +, spaces, dashes', () => {
  assert.equal(toNgE164('2348012345678'), '2348012345678');
  assert.equal(toNgE164('+2348012345678'), '2348012345678');
  assert.equal(toNgE164('+234 801-234-5678'), '2348012345678');
});

test('adds the country code to a bare 10-digit subscriber number', () => {
  assert.equal(toNgE164('8012345678'), '2348012345678');
});

test('is idempotent — normalising an already-normalised number is a no-op', () => {
  const once = toNgE164('08012345678');
  assert.equal(toNgE164(once), once);
  assert.equal(once, '2348012345678');
});

test('handles empty / junk input without throwing', () => {
  assert.equal(toNgE164(''), '');
  assert.equal(toNgE164(undefined as unknown as string), '');
});
