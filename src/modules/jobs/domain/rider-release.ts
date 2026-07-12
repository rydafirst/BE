import type { JobStatus } from './job-state-machine.js';

/**
 * Rider "release back to the pool": a rider who accepted a job but can't continue may hand it back
 * so another rider is matched — but only BEFORE pickup. Once the parcel is in hand (IN_PROGRESS or
 * later) the rider must use the failed-attempt / dispute paths instead. Money never moves on a
 * release; the order simply returns to SEARCHING with the escrow still held.
 */
const RELEASABLE: readonly JobStatus[] = ['ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP'];

export function canReleaseJob(status: JobStatus): boolean {
  return RELEASABLE.includes(status);
}

/** Abuse guard: a rider may release at most this many jobs per rolling day. */
export const MAX_RIDER_RELEASES_PER_DAY = 5;
export const RELEASE_WINDOW_SECONDS = 86_400;
