import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewQueueRank, sortReviewQueue, type QueueEntry } from './review-queue.js';

test('UNDER_REVIEW ranks above everything (reviewer acts first)', () => {
  assert.ok(reviewQueueRank('UNDER_REVIEW') < reviewQueueRank('ACTION_REQUIRED'));
  assert.ok(reviewQueueRank('ACTION_REQUIRED') < reviewQueueRank('INCOMPLETE'));
  assert.ok(reviewQueueRank('APPROVED') > reviewQueueRank('NO_TRACK'));
});

test('queue sorts by neediness, then oldest-waiting first', () => {
  const entries: QueueEntry[] = [
    { riderId: 'approved', status: 'APPROVED', oldestPendingAt: 1 },
    { riderId: 'review-new', status: 'UNDER_REVIEW', oldestPendingAt: 200 },
    { riderId: 'review-old', status: 'UNDER_REVIEW', oldestPendingAt: 100 },
    { riderId: 'rejected', status: 'ACTION_REQUIRED', oldestPendingAt: 50 },
  ];
  const order = sortReviewQueue(entries).map((e) => e.riderId);
  assert.deepEqual(order, ['review-old', 'review-new', 'rejected', 'approved']);
});
