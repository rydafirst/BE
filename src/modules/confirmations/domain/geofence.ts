import { haversineMeters, type GeoPoint } from '../../jobs/domain/geo.js';

export const DEFAULT_ARRIVAL_RADIUS_M = 80;

/** Arrival is only valid when the rider is physically within the drop geofence. */
export function isWithinGeofence(rider: GeoPoint, target: GeoPoint, radiusMeters = DEFAULT_ARRIVAL_RADIUS_M): boolean {
  return haversineMeters(rider, target) <= radiusMeters;
}
