import { Money } from '../../payments/domain/money.js';
import { etaMinutes, roadMeters } from './eta.js';

// ERRAND = "buy-for-me": the TRIP (store -> customer) is priced exactly like a delivery; the goods
// money the customer types is separate and routed to the vendor, not part of the fare.
export type JobType = 'DELIVERY' | 'RIDE' | 'ERRAND';

/**
 * Upfront pricing config (kobo). Tuned so riders are paid fairly for Lagos deliveries — the old
 * distance-only model paid too little (a 5 km trip netted ~₦900). The model now mirrors how Uber/Lyft/
 * Bolt price: base + per-km + per-minute, with a minimum-fare floor so short trips still pay. The
 * per-minute term uses the trip's estimated minutes so time-in-traffic is compensated, not just distance.
 *
 * Target: a rider nets ~₦2,800 on a typical short (≈5 km straight-line ≈ 7 km road) Lagos delivery —
 * see fare.spec.ts. This is set against the standalone Lagos bike-dispatch market (₦3,000+ per drop),
 * which is what riders actually compare to — not car ride-hailing. The distance charge is billed on the
 * ESTIMATED ROAD distance (ROAD_DISTANCE_FACTOR), and the per-minute term uses a realistic 15 km/h city
 * average, so a rider is paid for the trip they ride and the time they lose in traffic.
 * All values are deterministic + testable; retune here with real ops data. `platformFeePct` is added on
 * top and kept by the platform; the rider receives the base+distance+time subtotal.
 */
export const FARE_CONFIG = {
  baseMinor: { DELIVERY: 70_000, RIDE: 90_000, ERRAND: 70_000 },      // ₦700 / ₦900 / ₦700 base (errand trip = delivery)
  perKmMinor: 22_000,                                 // ₦220 / road-km
  perMinuteMinor: 2_000,                              // ₦20 / min (minutes from the 15 km/h city ETA)
  minimumMinor: { DELIVERY: 150_000, RIDE: 180_000, ERRAND: 150_000 }, // ₦1,500 / ₦1,800 / ₦1,500 rider-subtotal floor
  platformFeePct: 10,                                 // %
} as const;

export interface FareBreakdown {
  baseMinor: number;
  distanceMinor: number;
  timeMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
}

/**
 * Deterministic upfront fare for a delivery or ride. Integer kobo throughout.
 *
 * `durationMinutes` defaults to the distance-derived ETA (`etaMinutes`) so every existing caller keeps
 * working with two args; once a real routing engine gives a live duration, pass it as the third arg and
 * the per-minute charge reflects actual traffic — no other change needed (same signature/shape).
 *
 * The minimum-fare floor is folded into the base line so the breakdown rows always sum to the total.
 */
export function computeFare(
  type: JobType,
  distanceMeters: number,
  durationMinutes: number = etaMinutes(distanceMeters),
): FareBreakdown {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('distanceMeters must be a non-negative number');
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new Error('durationMinutes must be a non-negative number');
  }
  const base = FARE_CONFIG.baseMinor[type];
  // Bill distance on the estimated ROAD distance (not the crow-flies input), matching what the rider
  // actually travels and keeping it consistent with the ETA (etaMinutes scales by the same factor).
  const distance = Math.round((roadMeters(distanceMeters) / 1000) * FARE_CONFIG.perKmMinor);
  const time = Math.round(durationMinutes * FARE_CONFIG.perMinuteMinor);

  const rawSubtotal = base + distance + time;
  const subtotal = Math.max(rawSubtotal, FARE_CONFIG.minimumMinor[type]);
  // Any minimum-fare top-up rides on the base line, so base+distance+time === subtotal (rows sum).
  const baseWithFloor = base + (subtotal - rawSubtotal);
  const platformFee = Math.round((subtotal * FARE_CONFIG.platformFeePct) / 100);

  return {
    baseMinor: baseWithFloor,
    distanceMinor: distance,
    timeMinor: time,
    platformFeeMinor: platformFee,
    totalMinor: subtotal + platformFee,
  };
}

export function fareToMoney(b: FareBreakdown): Money {
  return Money.of(b.totalMinor);
}
