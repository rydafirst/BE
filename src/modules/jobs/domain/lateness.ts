import { etaMinutes } from './eta.js';
import { haversineMeters, type GeoPoint } from './geo.js';
import { type JobStatus } from './job-state-machine.js';
import { type StatusEvent } from './stage-timing.js';

/**
 * Late-detection for the drop leg of a delivery.
 *
 * Everything here is pure and server-authoritative: the *expected* time comes from the stored
 * pickup/drop-off coordinates, and the *elapsed* time is measured against the server clock from the
 * recorded pickup event — so a rider can't spoof it (fake GPS, fake "arrived") to dodge a late flag,
 * and a customer can't fabricate one. A late verdict only ever drives notifications; it never touches
 * the ledger, so a wrong reading can't move money.
 *
 * Scope is the drop leg only (pickup -> completion). Before pickup the relevant leg is rider->pickup,
 * whose distance we don't hold; and WAITING / AWAITING_RESOLUTION are excluded because there the
 * delay is the recipient's, not the rider's (mirroring the inactivity monitor's exclusions).
 */
export type LatenessTier = 'none' | 'rider' | 'all';

/** Stages where drop-leg lateness is meaningful (picked up, still in flight, not yet completed). */
export const DROP_LEG_STAGES: readonly JobStatus[] = ['IN_PROGRESS', 'EN_ROUTE_DROP', 'ARRIVED', 'AWAITING_CODE'];

/** Nudge the rider once elapsed reaches this multiple of the ETA; tell customer + ops at the higher one. */
export const RIDER_MULTIPLE = 1.5;
export const ESCALATE_MULTIPLE = 2;

export function isDropLegStage(status: JobStatus): boolean {
  return DROP_LEG_STAGES.includes(status);
}

/** Expected drop-leg travel time in seconds, from pickup to drop-off. */
export function expectedDropSeconds(pickup: GeoPoint, dropoff: GeoPoint): number {
  return etaMinutes(haversineMeters(pickup, dropoff)) * 60;
}

/** Epoch ms the delivery was first picked up (earliest IN_PROGRESS), or undefined if not yet. */
export function pickedUpAt(events: readonly StatusEvent[]): number | undefined {
  const times = events.filter((e) => e.status === 'IN_PROGRESS').map((e) => e.at);
  return times.length ? Math.min(...times) : undefined;
}

/**
 * How late the drop leg is, as an escalation tier. `none` until the rider threshold, then `rider`,
 * then `all` (customer + ops) at the higher threshold. Guards a non-positive expected time so a
 * zero-distance or bad ETA can never read as "infinitely late".
 */
export function latenessTier(params: {
  expectedSec: number; elapsedSec: number; riderMultiple?: number; escalateMultiple?: number;
}): LatenessTier {
  const { expectedSec, elapsedSec, riderMultiple = RIDER_MULTIPLE, escalateMultiple = ESCALATE_MULTIPLE } = params;
  if (!(expectedSec > 0)) return 'none';
  if (elapsedSec >= expectedSec * escalateMultiple) return 'all';
  if (elapsedSec >= expectedSec * riderMultiple) return 'rider';
  return 'none';
}

export function riderLateMessage(): { title: string; body: string } {
  return { title: 'Running behind', body: 'This delivery is taking longer than expected — head to the drop-off or update your status.' };
}
export function customerLateMessage(): { title: string; body: string } {
  return { title: 'Your rider is running late', body: 'Your delivery is taking longer than expected. We’re keeping an eye on it.' };
}

/** Once-only outbox keys, one per tier, so neither party is alerted more than once per delivery. */
export function riderLateKey(jobId: string): string { return `late:rider:${jobId}`; }
export function customerLateKey(jobId: string): string { return `late:customer:${jobId}`; }
