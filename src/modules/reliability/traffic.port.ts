/**
 * Traffic-aware travel time, used to judge lateness fairly. An adapter (Google Routes) implements this;
 * the reliability service depends only on this port so the provider is swappable and easily faked in tests.
 * Returns null whenever a real traffic estimate can't be obtained (not configured, API error, no route) —
 * the caller treats that as "uncertain" and routes the case to an admin rather than auto-penalising.
 */
export interface TrafficPoint { lat: number; lng: number }

export interface TrafficProvider {
  /** Traffic-adjusted driving time (seconds) between two points right now, or null if unavailable. */
  travelTimeSec(from: TrafficPoint, to: TrafficPoint): Promise<number | null>;
}

export const TRAFFIC_PROVIDER = Symbol('TRAFFIC_PROVIDER');
