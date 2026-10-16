import { Money } from '../../payments/domain/money.js';
import { etaMinutes, roadMeters } from './eta.js';

// ERRAND = "buy-for-me": the TRIP (store -> customer) is priced exactly like a delivery; the goods
// money the customer types is separate and routed to the vendor, not part of the fare.
export type JobType = 'DELIVERY' | 'RIDE' | 'ERRAND';

// Delivery speed tier. EXPRESS = full price, delivered direct & fast (and dispatched to riders first).
// ECONOMY = cheaper for the customer (and a lower rider payout), but batchable — the "I don't mind
// waiting" option. Only ECONOMY orders may be stacked by a rider.
export type JobTier = 'EXPRESS' | 'ECONOMY';

/**
 * Upfront pricing config (kobo). Pricing is DISTANCE-ONLY: base + per-km, with a minimum-fare floor so
 * short trips still pay. `platformFeePct` is added on top and kept by the platform; the rider receives
 * the base+distance subtotal.
 *
 * The per-minute (time) charge was DROPPED (founder decision, Oct 2026). Rationale: the ETA is derived
 * from distance, so charging per-minute effectively billed distance twice and made long-distance trips
 * (>18 km — the majority of Lagos deliveries) too expensive for customers, and it made two same-distance
 * trips quote different prices (time swings with the route). Distance-only pricing is cheaper on long
 * runs and fully predictable: same distance → same price, every time. `perMinuteMinor` is kept at 0 so
 * the breakdown shape is unchanged and the time charge can be re-enabled later from one line if needed.
 *
 * The distance charge is billed on the ESTIMATED ROAD distance (ROAD_DISTANCE_FACTOR), not the crow-flies
 * input, so a rider is paid for the trip they actually ride. All values are deterministic + testable;
 * retune here with real ops data.
 */
export const FARE_CONFIG = {
  baseMinor: { DELIVERY: 70_000, RIDE: 90_000, ERRAND: 70_000 },      // ₦700 / ₦900 / ₦700 base (errand trip = delivery)
  perKmMinor: 22_000,                                 // ₦220 / road-km
  perMinuteMinor: 0,                                  // TIME CHARGE DROPPED — distance-only pricing (set >0 to re-enable)
  minimumMinor: { DELIVERY: 150_000, RIDE: 180_000, ERRAND: 150_000 }, // ₦1,500 / ₦1,800 / ₦1,500 rider-subtotal floor
  platformFeePct: 10,                                 // %
} as const;

export interface FareBreakdown {
  baseMinor: number;
  distanceMinor: number;
  timeMinor: number;
  discountMinor: number;    // <= 0; the economy-tier saving (0 for express)
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
  discountPct = 0,
): FareBreakdown {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error('distanceMeters must be a non-negative number');
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new Error('durationMinutes must be a non-negative number');
  }
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct >= 100) {
    throw new Error('discountPct must be between 0 and 100');
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
  // ECONOMY tier: knock discountPct off the rider subtotal; the platform fee is then taken on the
  // DISCOUNTED subtotal, so the customer pays less AND the rider is paid proportionally less. Rows sum:
  // base+distance+time+discount = net subtotal; + fee = total.
  const discount = discountPct > 0 ? -Math.round((subtotal * discountPct) / 100) : 0;
  const netSubtotal = subtotal + discount;
  const platformFee = Math.round((netSubtotal * FARE_CONFIG.platformFeePct) / 100);

  return {
    baseMinor: baseWithFloor,
    distanceMinor: distance,
    timeMinor: time,
    discountMinor: discount,
    platformFeeMinor: platformFee,
    totalMinor: netSubtotal + platformFee,
  };
}

export function fareToMoney(b: FareBreakdown): Money {
  return Money.of(b.totalMinor);
}
