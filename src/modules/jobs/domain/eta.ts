/**
 * Rough travel-time + distance helpers for the rider discovery feed ("X min away") and the customer's
 * live delivery timer. Deterministic and pure so the feed's proximity/ETA is testable. A real routing
 * engine can replace these later without changing callers — same signature.
 */
// Lagos bikes weave traffic, but the citywide door-to-door average — including go-slow, junctions and
// the last-100m crawl — is far below open-road speed. 15 km/h is the realistic effective average; the
// old 24 made every ETA (and the customer's delivery timer) read far too short and flip to "late"
// almost immediately. Tune with real ops data.
export const AVG_CITY_KMH = 15;

// Straight-line (haversine) distance under-counts what a rider actually travels: Lagos roads wind, and
// one-ways/bridges add more. ~1.4x turns crow-flies metres into a realistic road distance, used for
// BOTH the ETA and the distance component of the fare so the two always agree.
export const ROAD_DISTANCE_FACTOR = 1.4;

/** Estimated real road distance (metres) from a straight-line distance. */
export function roadMeters(straightLineMeters: number): number {
  if (!Number.isFinite(straightLineMeters) || straightLineMeters < 0) throw new Error('distanceMeters must be a non-negative number');
  return straightLineMeters * ROAD_DISTANCE_FACTOR;
}

/**
 * Whole-minute ETA for a straight-line distance, floored at 1 minute. The input is crow-flies metres;
 * this scales it to estimated road distance (ROAD_DISTANCE_FACTOR) before applying the city average, so
 * the estimate reflects the trip the rider actually rides — not the straight line.
 */
export function etaMinutes(distanceMeters: number, avgKmh: number = AVG_CITY_KMH): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) throw new Error('distanceMeters must be a non-negative number');
  if (!(avgKmh > 0)) throw new Error('avgKmh must be positive');
  const minutes = ((roadMeters(distanceMeters) / 1000) / avgKmh) * 60;
  return Math.max(1, Math.round(minutes));
}

/** Distance in kilometres, rounded to one decimal (e.g. 2.4). */
export function distanceKm(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) throw new Error('distanceMeters must be a non-negative number');
  return Math.round(distanceMeters / 100) / 10;
}
