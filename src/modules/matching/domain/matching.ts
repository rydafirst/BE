import { haversineMeters, type GeoPoint } from '../../jobs/domain/geo.js';

export interface RiderCandidate {
  riderId: string;
  online: boolean;
  kycApproved: boolean;
  busy: boolean;
  pos: GeoPoint;
}

export const DEFAULT_MATCH_RADIUS_M = 5000;

/** Only approved, online, free riders within radius; nearest first. Deny-by-default. */
export function eligibleRiders(
  candidates: readonly RiderCandidate[],
  pickup: GeoPoint,
  radiusMeters = DEFAULT_MATCH_RADIUS_M,
): RiderCandidate[] {
  return candidates
    .filter((c) => c.online && c.kycApproved && !c.busy && haversineMeters(c.pos, pickup) <= radiusMeters)
    .sort((a, b) => haversineMeters(a.pos, pickup) - haversineMeters(b.pos, pickup));
}
