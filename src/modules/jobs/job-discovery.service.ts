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
    tier: 'EXPRESS' | 'ECONOMY';  // rider feed tags these HIGH-PAY (express) / LOW-PAY (economy)
    pickupArea: string; dropoffArea: string; pickupApprox: { lat: number; lng: number };
    tripDistanceMeters: number; tripEtaMin: number;      // pickup -> dropoff
    toPickupMeters?: number; toPickupEtaMin?: number;    // rider -> pickup (only when location is known)
    // #4 MULTI-STOP: total drop-offs (primary + extras). Present only for multi-stop jobs (>1), so the
    // rider sees a "MULTI-STOP · N DROPS" badge and can judge the extra work BEFORE accepting.
    stopCount?: number;
    // What the RIDER actually earns: the customer's charge (`amountMinor`) MINUS the platform fee. The
    // rider must decide on their take-home, never the gross the customer pays — showing the gross made a
    // ₦5,000 job look like ₦5,000 to the rider when they'd be paid less.
    riderPayoutMinor: number;
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
      // What the rider actually earns. For a plain delivery that's the whole charge minus the platform
      // fee. For an ERRAND the charge also contains the customer's ITEM money (paid to the vendor, never
      // the rider), so the rider earns only the DELIVERY fee (net of the platform fee) — otherwise the
      // board would show the goods money as rider earnings and hugely overstate the payout.
      const grossFareMinor = j.type === 'ERRAND' && j.errand
        ? (j.errand.deliveryFeeMinor ?? Math.max(0, j.amountMinor - j.errand.goodsMinor))
        : j.amountMinor;
      return {
        id: j.id, type: j.type, tier: (j.tier ?? 'EXPRESS'), amountMinor: j.amountMinor, currency: j.currency, createdAt: j.createdAt,
        riderPayoutMinor: Math.max(0, grossFareMinor - (j.platformFeeMinor ?? 0)),
        pickupArea: j.pickupArea || coarseArea(j.pickupAddress),
        dropoffArea: j.dropoffArea || coarseArea(j.dropoffAddress),
        pickupApprox: approximatePoint(j.pickup),
        tripDistanceMeters: Math.round(tripMeters),
        tripEtaMin: etaMinutes(tripMeters),
        ...(toPickup !== undefined ? { toPickupMeters: Math.round(toPickup), toPickupEtaMin: etaMinutes(toPickup) } : {}),
        ...((j.extraStops?.length ?? 0) > 0 ? { stopCount: (j.extraStops?.length ?? 0) + 1 } : {}),
      };
    });
    // EXPRESS is always shown FIRST (express = fast, so riders get offered it before economy); within a
    // tier, proximity orders the board (nearest-first with a location, else newest-first).
    const tierRank = (t: 'EXPRESS' | 'ECONOMY') => (t === 'ECONOMY' ? 1 : 0);
    const within = riderPos
      ? (a: AvailableJob, b: AvailableJob) => a.toPickupMeters! - b.toPickupMeters!
      : (a: AvailableJob, b: AvailableJob) => b.createdAt.localeCompare(a.createdAt);
    return mapped.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || within(a, b));
  }
}
