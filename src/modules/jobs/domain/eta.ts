/**
 * Rough travel-time + distance helpers for the rider discovery feed (Uber-style "X min away").
 * Deterministic and pure so the feed's proximity/ETA is testable. A real routing engine can replace
 * these later without changing callers — same signature.
 */
export const AVG_CITY_KMH = 24; // urban courier average (bikes weave traffic); tune with ops data

/** Whole-minute ETA for a straight-line distance, floored at 1 minute. */
export function etaMinutes(distanceMeters: number, avgKmh: number = AVG_CITY_KMH): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) throw new Error('distanceMeters must be a non-negative number');
  if (!(avgKmh > 0)) throw new Error('avgKmh must be positive');
  const minutes = ((distanceMeters / 1000) / avgKmh) * 60;
  return Math.max(1, Math.round(minutes));
}

/** Distance in kilometres, rounded to one decimal (e.g. 2.4). */
export function distanceKm(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) throw new Error('distanceMeters must be a non-negative number');
  return Math.round(distanceMeters / 100) / 10;
}
