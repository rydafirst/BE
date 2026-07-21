/** A number the client may dial, plus whether it hides the owner's real line. */
export interface CallableContact {
  /** What to dial, or null when the counterparty is not reachable for this job right now. */
  number: string | null;
  /** True when `number` is a proxy that conceals the real phone number. */
  masked: boolean;
}

/**
 * Supplies a dialable number for one party of a job to reach the other.
 *
 * This is a port rather than a direct phone lookup because handing out real personal numbers is a
 * privacy exposure we intend to retire: riders and customers keep each other's numbers forever, and
 * nothing stops contact after the delivery ends. The industry answer (Uber, Bolt) is a masked proxy
 * number that only routes while the job is live.
 *
 * Clients dial whatever `number` they are given and display `masked` — so swapping the direct
 * adapter for a proxy provider later is a one-line change at the composition root, with no change to
 * the mobile or web apps.
 */
export interface ContactChannel {
  numberFor(params: { jobId: string; callerUserId: string; subjectUserId: string }): Promise<CallableContact>;
}

export const CONTACT_CHANNEL = Symbol('CONTACT_CHANNEL');
