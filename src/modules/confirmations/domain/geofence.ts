import { haversineMeters, type GeoPoint } from '../../jobs/domain/geo.js';

export const DEFAULT_ARRIVAL_RADIUS_M = 80;

/**
 * Cap on how much a phone's self-reported GPS accuracy may widen the arrival radius. Urban GPS in
 * Nigeria (tall buildings, weak signal, low-end handsets) routinely drifts 50-200m, so a rider
 * standing at the point can read as "outside" a tight fence. We add the phone's own accuracy estimate
 * to the allowed distance — but cap it, so a spoofed "my accuracy is 5km" can't defeat the fence.
 */
export const MAX_GPS_SLACK_M = 150;

/** Arrival is only valid when the rider is physically within the geofence (exact, no GPS slack). */
export function isWithinGeofence(rider: GeoPoint, target: GeoPoint, radiusMeters = DEFAULT_ARRIVAL_RADIUS_M): boolean {
  return haversineMeters(rider, target) <= radiusMeters;
}

/**
 * Accuracy-aware arrival check: the rider is "arrived" when their distance to the target is within the
 * radius PLUS a bounded allowance for the fix's own uncertainty. Returns the measured distance too, so
 * the caller can tell the rider exactly how far off they read (drift vs genuinely far away).
 */
export function checkArrival(
  rider: GeoPoint,
  target: GeoPoint,
  radiusMeters: number,
  accuracyMeters = 0,
): { ok: boolean; distanceMeters: number; allowedMeters: number } {
  const distanceMeters = haversineMeters(rider, target);
  const slack = Math.min(Math.max(0, Math.round(accuracyMeters)), MAX_GPS_SLACK_M);
  const allowedMeters = radiusMeters + slack;
  return { ok: distanceMeters <= allowedMeters, distanceMeters, allowedMeters };
}
