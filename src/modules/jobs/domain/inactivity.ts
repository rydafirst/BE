import { type JobStatus } from './job-state-machine.js';

const MIN = 60_000;

/**
 * How long a rider may sit in a stage before we nudge them.
 *
 * Only stages where the RIDER is the one who has to act. Deliberately excluded:
 *  - WAITING — the rider is correctly standing still and is being paid for it;
 *  - AWAITING_RESOLUTION — the ball is in the sender's court, not the rider's;
 *  - CREATED/FUNDED/SEARCHING — nobody is assigned yet;
 *  - every terminal or disputed state.
 *
 * Nudging a rider for something that is not their move is how an app teaches people to ignore it,
 * which would undo the notification work in Phase 3. Thresholds are generous on purpose: Lagos
 * traffic makes a slow leg normal, and the reminder is for a FORGOTTEN status update, not a slow one.
 */
const STALL_AFTER: Partial<Record<JobStatus, number>> = {
  ACCEPTED: 10 * MIN,        // accepted but never started moving
  EN_ROUTE_PICKUP: 30 * MIN, // long, because traffic
  AT_PICKUP: 10 * MIN,       // arrived but never confirmed the pickup
  IN_PROGRESS: 5 * MIN,      // picked up but never marked en route
  EN_ROUTE_DROP: 40 * MIN,
  ARRIVED: 10 * MIN,         // at the door but never entered the code or started the wait timer
  AWAITING_CODE: 10 * MIN,
};

/** Whether a nudge is warranted for a rider who has been in `status` for `elapsedMs`. */
export function isStalled(status: JobStatus, elapsedMs: number): boolean {
  const threshold = STALL_AFTER[status];
  return threshold !== undefined && elapsedMs >= threshold;
}

/** The stages we bother to watch at all — lets the scan skip everything else cheaply. */
export function watchedStages(): JobStatus[] {
  return Object.keys(STALL_AFTER) as JobStatus[];
}

/**
 * What to say. Phrased as a prompt to update the app rather than an accusation — the usual cause is
 * a rider who did the work and forgot to tap, not a rider who stopped.
 */
export function stallReminder(status: JobStatus): { title: string; body: string } | null {
  switch (status) {
    case 'ACCEPTED':
      return { title: 'Still on this delivery?', body: 'Tap to start heading to the pickup, or release it so another rider can take it.' };
    case 'EN_ROUTE_PICKUP':
      return { title: 'Reached the pickup?', body: 'Mark that you have arrived so the sender knows you are there.' };
    case 'AT_PICKUP':
      return { title: 'Collected the parcel?', body: 'Confirm the pickup in the app so the delivery can move on.' };
    case 'IN_PROGRESS':
      return { title: 'On your way?', body: 'Mark that you are heading to the drop-off so the sender can track you.' };
    case 'EN_ROUTE_DROP':
      return { title: 'Arrived at the drop-off?', body: 'Mark your arrival so the recipient knows to come out.' };
    case 'ARRIVED':
    case 'AWAITING_CODE':
      return { title: 'Finish this delivery', body: 'Enter the recipient’s code to complete it — or start the wait timer if nobody has come out.' };
    default:
      return null;
  }
}

/** Stable key so a rider is nudged at most once per stage, however often the scan runs. */
export function reminderKey(jobId: string, status: JobStatus): string {
  return `stall:${jobId}:${status}`;
}
