import { type JobStatus } from './job-state-machine.js';

/**
 * Whether the assigned *rider* may see the recipient's phone number yet.
 *
 * The recipient is a third party the rider has no business contacting until they are actually
 * carrying the package. Exposing the number earlier (while heading to, or waiting at, pickup) lets a
 * rider call/harass the recipient before the job needs it and over-collects personal data against
 * NDPR data-minimisation. So the phone is withheld until the delivery has genuinely started
 * (`IN_PROGRESS` = picked up) and only while the job is still in flight — mirroring `contact-window`.
 *
 * The customer is unaffected: the recipient's number is the customer's *own* contact, entered by
 * them, so they always see it. This gate is about what the rider's payload may contain.
 */
const RIDER_MAY_SEE_RECIPIENT: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'IN_PROGRESS',
  'EN_ROUTE_DROP',
  'ARRIVED',
  'AWAITING_CODE',
  'WAITING',
  'AWAITING_RESOLUTION',
  'EN_ROUTE_STOP',
]);

export function recipientPhoneVisibleToRider(status: JobStatus): boolean {
  return RIDER_MAY_SEE_RECIPIENT.has(status);
}

/**
 * Field-level redaction applied server-side before a job is returned to the rider. Returns the job
 * unchanged for the customer (their own data) and for the rider once pickup has happened; otherwise
 * strips the recipient's phone while keeping the name. Generic over the job shape so it needs no
 * import of the `Job` type (avoids a domain↔ports cycle) and can be unit-tested on a plain object.
 *
 * Crucially this drops the phone from the *response body* — hiding it only in the UI would leave it
 * trivially recoverable from the API, which is the actual access-control bug (not a cosmetic one).
 */
export function redactRecipientPhoneForRider<
  T extends { status: JobStatus; recipient?: { name: string; phone?: string } },
>(job: T, viewerIsRider: boolean): T {
  if (!viewerIsRider) return job; // customer sees their own recipient contact
  if (!job.recipient) return job;
  if (recipientPhoneVisibleToRider(job.status)) return job; // picked up — the rider needs it now
  const { phone, ...withoutPhone } = job.recipient;
  return { ...job, recipient: { ...withoutPhone } };
}
