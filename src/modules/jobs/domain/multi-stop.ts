import type { GeoPoint } from './geo.js';
import type { JobStatus } from './job-state-machine.js';

/**
 * #4 MULTI-STOP DELIVERIES — one pickup, several ordered drop-offs in a single booking.
 *
 * The primary `dropoff` on a Job is always stop #1 (with its own recipient + the existing DELIVERY
 * confirmation code). Each `ExtraStop` is a FURTHER drop-off that comes AFTER the primary one, in
 * array order: pickup -> dropoff -> extraStops[0] -> extraStops[1] -> … Each extra stop carries its
 * own recipient and its own hashed confirmation code, delivered by that recipient in turn. Escrow is
 * released to the rider EXACTLY ONCE, only after the FINAL stop is confirmed (see JobsService).
 *
 * Additive & least-breaking: a single-stop delivery simply has no `extraStops`, so every field and
 * code path here is inert and the single-stop journey is unchanged.
 */

/** The customer-supplied, price-irrelevant metadata for one extra drop-off (paired to a signed point). */
export interface ExtraStopInput {
  address?: string;
  area?: string;
  recipient?: { name: string; phone?: string };
  item?: string;
  instructions?: string;
}

/** A stored extra drop-off: its (signed) point + metadata + its own hashed code and delivery status. */
export interface ExtraStop extends ExtraStopInput {
  point: GeoPoint;
  status: 'PENDING' | 'DELIVERED';
  deliveredAt?: number;        // epoch ms the stop's code was confirmed
  // Internal only — NEVER serialised to any client. Redacted at every service read boundary.
  codeHash?: string;           // HMAC of the stop's single-use confirmation code (never plaintext)
  attempts?: number;           // wrong-code guesses, capped like the primary code
}

/** Max extra drop-offs on one booking (bounds fare/route work + a runaway request body). */
export const MAX_EXTRA_STOPS = 8;

/** True when the job actually has extra stops (i.e. is a multi-stop delivery). */
export function hasExtraStops(job: { extraStops?: readonly ExtraStop[] }): boolean {
  return (job.extraStops?.length ?? 0) > 0;
}

/** True once every extra stop has been delivered (vacuously true when there are none). */
export function allExtraStopsDelivered(extraStops?: readonly ExtraStop[]): boolean {
  return (extraStops ?? []).every((s) => s.status === 'DELIVERED');
}

/** Index of the next PENDING extra stop (0-based within extraStops), or -1 when all are delivered. */
export function nextPendingStopIndex(extraStops?: readonly ExtraStop[]): number {
  return (extraStops ?? []).findIndex((s) => s.status === 'PENDING');
}

/**
 * Whether the rider may see an extra stop's recipient phone yet. Mirrors the primary
 * recipient-visibility rule: withheld until the package is actually in transit (IN_PROGRESS onward),
 * so the rider can't contact a downstream recipient before the job needs it (NDPR minimisation).
 */
const RIDER_MAY_SEE_STOP_RECIPIENT: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION',
  'EN_ROUTE_STOP', 'COMPLETED', 'RELEASED',
]);

/**
 * Redact stored extra stops for a client response. ALWAYS strips the internal `codeHash`/`attempts`
 * (a hash must never leak — it would let the wrong party brute-force a stop's code offline). For a
 * rider before pickup it also strips each recipient's phone, matching the primary redaction. Returns
 * the job unchanged when there are no extra stops, so single-stop payloads are untouched.
 */
export function redactExtraStopsForViewer<
  T extends { status: JobStatus; extraStops?: ExtraStop[] },
>(job: T, viewerIsRider: boolean): T {
  if (!job.extraStops || job.extraStops.length === 0) return job;
  const showPhone = !viewerIsRider || RIDER_MAY_SEE_STOP_RECIPIENT.has(job.status);
  const extraStops = job.extraStops.map((s) => {
    const { codeHash, attempts, recipient, ...rest } = s;
    const safeRecipient = recipient
      ? (showPhone ? recipient : { name: recipient.name })
      : undefined;
    return { ...rest, ...(safeRecipient ? { recipient: safeRecipient } : {}) } as ExtraStop;
  });
  return { ...job, extraStops };
}
