/**
 * Pure decisions for notifying the other party about a new chat message.
 *
 * Kept out of the service so the two security-critical choices — *who* gets told and *what* the
 * push says — are unit-testable in isolation and can't drift.
 */

/** The two participants of a job. `riderId` is absent until a rider has accepted. */
export interface JobParties {
  customerId: string;
  riderId?: string;
}

/**
 * The user who should be notified about a message: the *other* party, derived server-side from the
 * job's participants — never the sender, and never a client-supplied id.
 *
 * This is the IDOR guard. `post()` has already authorised the sender as a party of the job, so the
 * counterparty can only ever be the one other participant. Returns `undefined` when there is no
 * counterparty yet (no rider assigned) or the sender is somehow not a party — in which case nobody
 * is notified rather than notifying a wrong or arbitrary user.
 */
export function chatCounterparty(job: JobParties, senderId: string): string | undefined {
  if (senderId === job.customerId) return job.riderId; // customer -> rider (may be undefined pre-accept)
  if (job.riderId && senderId === job.riderId) return job.customerId; // rider -> customer
  return undefined; // not a party: notify nobody
}

/**
 * Content for a new-message push. Deliberately generic — it never contains the message text, so a
 * lock screen (a public surface) leaks nothing and the notification channel can't be turned into a
 * way to broadcast abusive content. The text is only ever visible inside the authenticated chat.
 */
export function chatNotification(): { title: string; body: string } {
  return { title: 'New message', body: 'You have a new message about your delivery.' };
}
