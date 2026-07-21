import { type JobStatus } from './job-state-machine.js';

/**
 * Whether the two parties of a job may still reach each other by phone.
 *
 * The rider and the sender need to coordinate — a wrong gate, a locked compound, "I'm outside".
 * But that need ends when the delivery does. Leaving the line open afterwards turns a one-off
 * transaction into a permanent channel between two strangers, which is a harassment vector and the
 * reason ride-hailing platforms cut contact at drop-off.
 *
 * Open only while the job is genuinely in flight:
 *  - before a rider is assigned there is nobody to call;
 *  - once it is COMPLETED, RELEASED, CANCELLED or FAILED_ATTEMPT the job is over;
 *  - DISPUTED and DISPUTE_RESOLVED are deliberately closed — a disagreement is exactly when direct
 *    contact should go through support rather than between the parties.
 */
const CONTACTABLE: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'ACCEPTED',
  'EN_ROUTE_PICKUP',
  'AT_PICKUP',
  'IN_PROGRESS',
  'EN_ROUTE_DROP',
  'ARRIVED',
  'AWAITING_CODE',
  'WAITING',
  'AWAITING_RESOLUTION',
]);

export function contactAllowed(status: JobStatus): boolean {
  return CONTACTABLE.has(status);
}
