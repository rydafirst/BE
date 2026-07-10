import type { JobStatus } from './job-state-machine.js';

/** Before pickup/start, a cancel is allowed and fully refundable. Once IN_PROGRESS, it must
 *  go through the fallback/dispute paths instead (no free cancel mid-job). */
const CANCELLABLE: readonly JobStatus[] = [
  'CREATED', 'FUNDED', 'SEARCHING', 'ACCEPTED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
];

export interface CancellationPolicy {
  allowed: boolean;
  refundFull: boolean;
}

export function cancellationPolicy(status: JobStatus): CancellationPolicy {
  const allowed = CANCELLABLE.includes(status);
  // Only FUNDED-or-later holds money; CREATED has no captured funds yet.
  const refundFull = allowed && status !== 'CREATED';
  return { allowed, refundFull };
}
