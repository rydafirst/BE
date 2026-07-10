import { haversineMeters, type GeoPoint } from '../../jobs/domain/geo.js';

export const MIN_EMIT_INTERVAL_MS = 1_000; // adaptive: >=1s between published pings on an active job
export const MAX_LOCATION_AGE_MS = 8_000;  // older than this -> show "reconnecting", never a frozen dot
export const URBAN_SPEED_MPS = 6;          // ~21.6 km/h assumption for ETA

/** Rate-limit published pings so we hit the <=2s p95 budget without flooding. */
export function shouldEmit(lastEmitMs: number | null, nowMs: number, minIntervalMs = MIN_EMIT_INTERVAL_MS): boolean {
  if (lastEmitMs === null) return true;
  return nowMs - lastEmitMs >= minIntervalMs;
}

/** A location is stale (rider likely disconnected) when the last ping is too old. */
export function isStale(lastPingMs: number | null, nowMs: number, maxAgeMs = MAX_LOCATION_AGE_MS): boolean {
  if (lastPingMs === null) return true;
  return nowMs - lastPingMs > maxAgeMs;
}

/** Coarse ETA in seconds from remaining distance. Replaced by Maps directions in prod. */
export function etaSeconds(from: GeoPoint, to: GeoPoint, speedMps = URBAN_SPEED_MPS): number {
  return Math.round(haversineMeters(from, to) / speedMps);
}

/** Channel authorization: ONLY the job's customer or assigned rider may subscribe. */
export function canAccessJobChannel(userId: string, job: { customerId: string; riderId?: string }): boolean {
  return userId === job.customerId || userId === job.riderId;
}
