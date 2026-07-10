import { Money } from '../../payments/domain/money.js';

export type JobType = 'DELIVERY' | 'RIDE';

/** Upfront pricing config (kobo). Tuned later with real ops data; deterministic + testable now. */
export const FARE_CONFIG = {
  baseMinor: { DELIVERY: 30_000, RIDE: 40_000 }, // ₦300 / ₦400
  perKmMinor: 12_000,                             // ₦120 / km
  platformFeePct: 10,                             // %
} as const;

export interface FareBreakdown {
  baseMinor: number;
  distanceMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
}

/** Deterministic upfront fare for both delivery and ride. Integer kobo throughout. */
export function computeFare(type: JobType, distanceMeters: number): FareBreakdown {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('distanceMeters must be a non-negative number');
  }
  const base = FARE_CONFIG.baseMinor[type];
  const distance = Math.round((distanceMeters / 1000) * FARE_CONFIG.perKmMinor);
  const subtotal = base + distance;
  const platformFee = Math.round((subtotal * FARE_CONFIG.platformFeePct) / 100);
  return {
    baseMinor: base,
    distanceMinor: distance,
    platformFeeMinor: platformFee,
    totalMinor: subtotal + platformFee,
  };
}

export function fareToMoney(b: FareBreakdown): Money {
  return Money.of(b.totalMinor);
}
