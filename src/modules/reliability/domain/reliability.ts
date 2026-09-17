/**
 * Rider reliability — the pure, testable core of the lateness-penalty system.
 *
 * Fairness first: a rider is only ever judged against how long the trip SHOULD have taken WITH the
 * traffic that was actually on the road (from a traffic-aware routing provider). If they were within a
 * tolerance of that time, traffic explains the delay and there is NO strike. Only a delay well beyond
 * what traffic accounts for is the rider's fault. When no traffic estimate is available (provider off or
 * erroring) we never auto-strike — the case goes to an admin to judge. Money is never touched here; the
 * money forfeit is a separate, admin-gated step (see LATE_FORFEIT_PCT) that stays off until enabled.
 */

/** A delivery's lateness outcome. `uncertain` means "send to an admin", never an automatic penalty. */
export type LatenessVerdict = 'on_time' | 'late' | 'uncertain';

export interface LatenessAssessment {
  verdict: LatenessVerdict;
  actualSec: number;
  staticEtaSec: number;        // our own 15 km/h estimate (fallback / context)
  trafficAwareSec?: number;    // the provider's traffic-adjusted estimate, when available
  ratio?: number;              // actual ÷ trafficAware (only when a traffic estimate exists)
}

/** How much over the traffic-aware time still counts as on-time (absorbs pickup faff, last-100m, etc.). */
export const LATE_TOLERANCE = 1.25;         // 25% over the traffic-adjusted estimate
/** Strikes inside the rolling window that trigger an automatic suspension. */
export const STRIKE_THRESHOLD = 3;
/** How long a strike counts before it expires (rolling window). */
export const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Length of an automatic suspension once the threshold is hit. */
export const SUSPENSION_MS = 24 * 60 * 60 * 1000;         // 1 day
/** Percent of a trip's DELIVERY fee forfeited on an upheld late trip (money step is admin-gated/off by default). */
export const LATE_FORFEIT_PCT = 10;

/**
 * Judge one delivery. `trafficAwareSec` is the provider's estimate of how long the trip should have
 * taken with the traffic that was on the road; when present it is the sole basis for the verdict (fair),
 * with the static ETA kept only for context. When absent, the verdict is `uncertain` — an admin decides.
 */
export function assessLateness(p: { actualSec: number; staticEtaSec: number; trafficAwareSec?: number }): LatenessAssessment {
  const { actualSec, staticEtaSec, trafficAwareSec } = p;
  if (!Number.isFinite(actualSec) || actualSec < 0) throw new Error('actualSec must be a non-negative number');
  if (!Number.isFinite(staticEtaSec) || staticEtaSec <= 0) throw new Error('staticEtaSec must be positive');

  if (trafficAwareSec !== undefined && Number.isFinite(trafficAwareSec) && trafficAwareSec > 0) {
    const ratio = actualSec / trafficAwareSec;
    // Late only if the rider took meaningfully longer than the traffic on the road warranted.
    const verdict: LatenessVerdict = actualSec > trafficAwareSec * LATE_TOLERANCE ? 'late' : 'on_time';
    return { verdict, actualSec, staticEtaSec, trafficAwareSec, ratio };
  }
  // No traffic estimate → we cannot fairly separate traffic from rider fault → let an admin judge.
  return { verdict: 'uncertain', actualSec, staticEtaSec };
}

/** A recorded strike against a rider. */
export interface Strike { at: number; jobId: string; reason?: string }

/** Strikes still inside the rolling window at `nowMs` (older ones have expired and no longer count). */
export function activeStrikes(strikes: readonly Strike[], nowMs: number, windowMs = STRIKE_WINDOW_MS): Strike[] {
  return strikes.filter((s) => nowMs - s.at <= windowMs);
}

/** Whether the active-strike count has reached the suspension threshold. */
export function shouldSuspend(activeStrikeCount: number, threshold = STRIKE_THRESHOLD): boolean {
  return activeStrikeCount >= threshold;
}

/** The epoch-ms a suspension started now would last until. */
export function suspensionUntil(nowMs: number, durationMs = SUSPENSION_MS): number {
  return nowMs + durationMs;
}

/** Whether a rider is currently suspended (has a future suspension end time). */
export function isSuspended(suspendedUntilMs: number | undefined | null, nowMs: number): boolean {
  return suspendedUntilMs != null && suspendedUntilMs > nowMs;
}

/** The money forfeited on an upheld late trip: a percentage of that trip's DELIVERY fee (integer kobo). */
export function lateForfeitMinor(deliveryFeeMinor: number, pct = LATE_FORFEIT_PCT): number {
  if (!Number.isInteger(deliveryFeeMinor) || deliveryFeeMinor < 0) throw new Error('deliveryFeeMinor must be a non-negative integer');
  return Math.round((deliveryFeeMinor * pct) / 100);
}

/** A 0–100 reliability score for the admin dashboard/ranking (100 when a rider has no rated trips yet). */
export function reliabilityScore(onTimeCount: number, totalJudged: number): number {
  if (totalJudged <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((onTimeCount / totalJudged) * 100)));
}
