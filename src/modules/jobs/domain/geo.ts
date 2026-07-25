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
