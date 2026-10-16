export interface GeoPoint { lat: number; lng: number }

const R = 6_371_000; // earth radius (m)
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres. Server-authoritative so the client can't understate distance. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

/**
 * Total great-circle distance of an ordered route (pickup -> drop-off -> extra stop 1 -> …), summing
 * every consecutive leg. This is the multi-stop distance the fare is computed from, so a booking with
 * several drop-offs is priced for the FULL path, never a single leg. For a two-point route (single
 * stop) it returns exactly `haversineMeters(points[0], points[1])`, so the single-stop price is
 * byte-for-byte unchanged. Server-authoritative — the client can never understate the distance.
 */
export function routeDistanceMeters(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1]!, points[i]!);
  return total;
}

/** Initial compass bearing (degrees, 0–360) from point a to point b. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Smallest angular difference (0–180°) between two compass bearings. */
export function bearingDiffDegrees(b1: number, b2: number): number {
  const d = Math.abs(b1 - b2) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * True when two trips head roughly the same way — the yardstick for letting a rider stack a second
 * economy delivery. We compare the bearing of each trip's pickup→dropoff; if they point within
 * `maxDiffDeg` of each other, the drops are "in the same direction".
 */
export function sameDirection(
  a: { pickup: GeoPoint; dropoff: GeoPoint },
  b: { pickup: GeoPoint; dropoff: GeoPoint },
  maxDiffDeg: number,
): boolean {
  return bearingDiffDegrees(bearingDegrees(a.pickup, a.dropoff), bearingDegrees(b.pickup, b.dropoff)) <= maxDiffDeg;
}

/**
 * Shortest allowed distance between pickup and drop-off. Generous enough to tolerate GPS drift, but
 * enough to reject a booking where both ends resolved to the same place (e.g. a customer tapping
 * "use my location" on both fields) — which otherwise prices as a zero-distance trip and makes both
 * "navigate" buttons open the same point.
 */
export const MIN_TRIP_METERS = 50;

/** True when pickup and drop-off are effectively the same location (below {@link MIN_TRIP_METERS}). */
export function isTripTooShort(pickup: GeoPoint, dropoff: GeoPoint): boolean {
  return haversineMeters(pickup, dropoff) < MIN_TRIP_METERS;
}
