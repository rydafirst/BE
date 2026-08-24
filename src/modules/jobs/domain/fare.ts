import { Money } from '../../payments/domain/money.js';
import { etaMinutes } from './eta.js';

export type JobType = 'DELIVERY' | 'RIDE';

/**
 * Upfront pricing config (kobo). Tuned so riders are paid fairly for Lagos deliveries — the old
 * distance-only model paid too little (a 5 km trip netted ~₦900). The model now mirrors how Uber/Lyft/
 * Bolt price: base + per-km + per-minute, with a minimum-fare floor so short trips still pay. The
 * per-minute term uses the trip's estimated minutes so time-in-traffic is compensated, not just distance.
 *
 * Target: a rider nets ~₦1,500–₦2,000 on a typical short (≈5 km) Lagos delivery — see fare.spec.ts.
 * All values are deterministic + testable; retune here with real ops data. `platformFeePct` is added on
 * top and kept by the platform; the rider receives the base+distance+time subtotal.
 */
export const FARE_CONFIG = {
  baseMinor: { DELIVERY: 50_000, RIDE: 60_000 },     // ₦500 / ₦600 base
  perKmMinor: 17_000,                                 // ₦170 / km
  perMinuteMinor: 2_000,                              // ₦20 / min
  minimumMinor: { DELIVERY: 90_000, RIDE: 120_000 }, // ₦900 / ₦1,200 rider-subtotal floor
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
  const distance = Math.round((distanceMeters / 1000) * FARE_CONFIG.perKmMinor);
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
