import type { OnboardingStatus } from './document-catalog.js';

export type QueueStatus = OnboardingStatus | 'NO_TRACK';

// Reviewer-facing ordering: surface the riders who need a reviewer's action *now* first. A rider
// in UNDER_REVIEW is waiting on us; the rest are waiting on the rider (or already done), so they
// sink down the queue. Lower rank = higher up.
const RANK: Readonly<Record<QueueStatus, number>> = {
  UNDER_REVIEW: 0,
  ACTION_REQUIRED: 1,
  EXPIRED: 2,
  INCOMPLETE: 3,
  NO_TRACK: 4,
  APPROVED: 5,
};

export function reviewQueueRank(status: QueueStatus): number {
  return RANK[status];
}

export interface QueueEntry { riderId: string; status: QueueStatus; oldestPendingAt: number }

/** Sort a review queue: neediest status first, then oldest-waiting first within a status. */
export function sortReviewQueue<T extends QueueEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const r = reviewQueueRank(a.status) - reviewQueueRank(b.status);
    return r !== 0 ? r : a.oldestPendingAt - b.oldestPendingAt;
  });
}
