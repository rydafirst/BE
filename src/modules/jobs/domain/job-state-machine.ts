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
  | 'WAITING'            // rider started the wait timer (10-min free grace, then metered)
  | 'AWAITING_RESOLUTION'// grace expired, no collection: sender must choose keep-waiting or return
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
  ARRIVED: ['AWAITING_CODE', 'COMPLETED', 'WAITING', 'FAILED_ATTEMPT', 'DISPUTED'],
  AWAITING_CODE: ['COMPLETED', 'WAITING', 'FAILED_ATTEMPT', 'DISPUTED'],
  // Rider waited out the free grace with no collection; sender decides what happens next.
  WAITING: ['COMPLETED', 'AWAITING_RESOLUTION', 'DISPUTED'],
  // Sender: keep waiting (now metered) -> WAITING; recipient shows -> COMPLETED; or initiate a
  // return, which completes the outbound (rider paid in full) and spawns a separate paid return job.
  AWAITING_RESOLUTION: ['WAITING', 'COMPLETED', 'DISPUTED'],
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
  /** A conflicting state change is a client error (409), not a server fault (500). */
  readonly httpStatus = 409;
  /** Safe to surface to the client — carries no internals. */
  readonly expose = true;
  readonly clientMessage = 'This action is no longer available for this delivery.';
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

/**
 * The delivery itself has landed and the escrow release has been claimed. COMPLETED is the moment
 * the receiver's code was accepted; RELEASED adds "funds have left escrow". Both mean the rider has
 * finished the job, so both are treated as done by the clients' Activity views and by the idempotent
 * re-confirm path (a client that timed out and retried must be told "done", not "invalid code").
 *
 * Deliberately NOT `isTerminal`: COMPLETED can still move to DISPUTED, and a disputed job is not a
 * failed delivery — the drop-off still happened.
 */
export function isDeliveryComplete(status: JobStatus): boolean {
  return status === 'COMPLETED' || status === 'RELEASED';
}
