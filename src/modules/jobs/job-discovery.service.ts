import { Inject, Injectable } from '@nestjs/common';
import { haversineMeters, type GeoPoint } from './domain/geo.js';
import { etaMinutes } from './domain/eta.js';
import { coarseArea } from './domain/area.js';
import { approximatePoint } from './domain/approx.js';
import { JOB_REPO, type Job, type JobRepository } from './ports.js';

/** PII-free projection shown to riders in the discovery feed. Only a COARSE area is exposed
 *  pre-accept (no exact coordinates, no recipient/customer/refund data). */
export type AvailableJob = Pick<Job, 'id' | 'type' | 'amountMinor' | 'currency' | 'createdAt'>
  & {
    pickupArea: string; dropoffArea: string; pickupApprox: { lat: number; lng: number };
    tripDistanceMeters: number; tripEtaMin: number;      // pickup -> dropoff
    toPickupMeters?: number; toPickupEtaMin?: number;    // rider -> pickup (only when location is known)
  };

/**
 * The rider-facing job board.
 *
 * Split out of JobsService because it shares none of the delivery lifecycle's machinery — no state
 * transitions, no money, no ownership assertions. It only reads the pool and projects it. Keeping
 * it separate means the PII rules below can be reviewed on their own, rather than buried in a class
 * that also moves money.
 */
@Injectable()
export class JobDiscoveryService {
  constructor(@Inject(JOB_REPO) private readonly jobs: JobRepository) {}

  /**
   * Jobs an online rider can currently accept: funded and still searching for a rider.
   * (First-accept-wins is enforced atomically in JobsService.accept(); this is discovery only.)
   *
   * SECURITY: returns a trimmed, PII-free projection — a rider sees only what they need to decide
   * (type, fare, coarse areas, approximate pickup). Recipient name/phone, customerId and the refund
   * account are NOT exposed until the rider actually claims the job.
   */
  async availableJobs(riderPos?: GeoPoint): Promise<AvailableJob[]> {
    const active = (await this.jobs.listActive()).filter((j) => j.status === 'SEARCHING');
    const mapped: AvailableJob[] = active.map((j) => {
      const tripMeters = haversineMeters(j.pickup, j.dropoff);
      // Distance/ETA from the rider to the pickup — the "X min away" a rider decides on.
      const toPickup = riderPos ? haversineMeters(riderPos, j.pickup) : undefined;
      return {
        id: j.id, type: j.type, amountMinor: j.amountMinor, currency: j.currency, createdAt: j.createdAt,
        pickupArea: j.pickupArea || coarseArea(j.pickupAddress),
        dropoffArea: j.dropoffArea || coarseArea(j.dropoffAddress),
        pickupApprox: approximatePoint(j.pickup),
        tripDistanceMeters: Math.round(tripMeters),
        tripEtaMin: etaMinutes(tripMeters),
        ...(toPickup !== undefined ? { toPickupMeters: Math.round(toPickup), toPickupEtaMin: etaMinutes(toPickup) } : {}),
      };
    });
    // Every rider sees every job — proximity only orders the board. With a location we sort
    // NEAREST-first (and each card shows its km + ETA); without one we fall back to newest-first.
    if (riderPos) return mapped.sort((a, b) => (a.toPickupMeters! - b.toPickupMeters!));
    return mapped.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
