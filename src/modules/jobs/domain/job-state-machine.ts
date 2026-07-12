/**
 * Shared Job state machine for DELIVERY and RIDE (03-architecture §5).
 * Transitions are guarded; illegal transitions are rejected before any I/O.
 * Money actions are bound to specific states only (07-engineering-standards §2.5):
 *   - RELEASE  only from COMPLETED
 *   - REFUND   only from CANCELLED / FAILED_ATTEMPT / DISPUTE_RESOLVED
 */
export type JobStatus =
  | 'CREATED'
  | 'FUNDED'
  | 'SEARCHING'
  | 'ACCEPTED'
  | 'EN_ROUTE_PICKUP'
  | 'AT_PICKUP'
  | 'IN_PROGRESS'        // PICKED_UP (delivery) / STARTED (ride)
  | 'EN_ROUTE_DROP'
  | 'ARRIVED'
  | 'AWAITING_CODE'      // delivery: awaiting receiver code
  | 'COMPLETED'
  | 'RELEASED'
  | 'CANCELLED'
  | 'FAILED_ATTEMPT'
  | 'DISPUTED'
  | 'DISPUTE_RESOLVED';

const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  CREATED: ['FUNDED', 'CANCELLED'],
  FUNDED: ['SEARCHING', 'CANCELLED'],
  SEARCHING: ['ACCEPTED', 'CANCELLED'],
  // A rider may release an accepted job back to the pool (-> SEARCHING) any time before pickup.
  ACCEPTED: ['EN_ROUTE_PICKUP', 'CANCELLED', 'SEARCHING'],
  EN_ROUTE_PICKUP: ['AT_PICKUP', 'CANCELLED', 'SEARCHING'],
  AT_PICKUP: ['IN_PROGRESS', 'CANCELLED', 'SEARCHING'],
  IN_PROGRESS: ['EN_ROUTE_DROP', 'DISPUTED'],
  EN_ROUTE_DROP: ['ARRIVED', 'DISPUTED'],
  ARRIVED: ['AWAITING_CODE', 'COMPLETED', 'FAILED_ATTEMPT', 'DISPUTED'],
  AWAITING_CODE: ['COMPLETED', 'FAILED_ATTEMPT', 'DISPUTED'],
  COMPLETED: ['RELEASED', 'DISPUTED'],
  RELEASED: [],
  CANCELLED: [],
  FAILED_ATTEMPT: ['DISPUTED'],
  DISPUTED: ['DISPUTE_RESOLVED'],
  DISPUTE_RESOLVED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Illegal job transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Money guards — the ONLY states from which funds may move. */
export function canRelease(status: JobStatus): boolean {
  return status === 'COMPLETED';
}
export function canRefund(status: JobStatus): boolean {
  return status === 'CANCELLED' || status === 'FAILED_ATTEMPT' || status === 'DISPUTE_RESOLVED';
}

export function isTerminal(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
