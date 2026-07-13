import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRating, cleanComment, isValidStars } from './rating.js';

test('stars must be an integer 1–5', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(isValidStars(n), true);
  for (const n of [0, 6, -1, 3.5, NaN]) assert.equal(isValidStars(n), false);
});

test('average rounds to one decimal and counts', () => {
  assert.deepEqual(averageRating([]), { average: 0, count: 0 });
  assert.deepEqual(averageRating([5, 5, 5]), { average: 5, count: 3 });
  assert.deepEqual(averageRating([4, 5]), { average: 4.5, count: 2 });
  assert.deepEqual(averageRating([5, 4, 4]), { average: 4.3, count: 3 });
});

test('comment is trimmed, capped and emptied to undefined', () => {
  assert.equal(cleanComment('  good rider '), 'good rider');
  assert.equal(cleanComment('   '), undefined);
  assert.equal(cleanComment(undefined), undefined);
  assert.equal(cleanComment('x'.repeat(600))?.length, 500);
});
