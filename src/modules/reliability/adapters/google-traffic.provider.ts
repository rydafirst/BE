import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { TrafficPoint, TrafficProvider } from '../traffic.port.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Traffic-aware travel time via Google's Routes API, reusing the SAME server-side GOOGLE_MAPS_API_KEY
 * that already powers address search — the only extra setup is enabling the "Routes API" on that Google
 * Cloud project (and allowing it if the key is API-restricted). We ask for a DRIVE route with
 * routingPreference TRAFFIC_AWARE: cars are a fair (lenient) proxy for a bike, since a bike is usually as
 * fast or faster, so this can only ever excuse a rider, never over-penalise.
 *
 * Fail-open toward the rider: ANY problem (key missing, API disabled, HTTP/timeout, no route) returns
 * null, and the reliability service then treats the trip as "uncertain" (admin decides) instead of
 * auto-striking. No key or provider internals ever leak to callers.
 */
@Injectable()
export class GoogleTrafficProvider implements TrafficProvider {
  private readonly log = new Logger(GoogleTrafficProvider.name);
  private readonly key: string;

  constructor(@Inject(ENV) env: Env) {
    this.key = env.GOOGLE_MAPS_API_KEY;
  }

  async travelTimeSec(from: TrafficPoint, to: TrafficPoint): Promise<number | null> {
    if (!this.key) return null; // provider not configured → caller falls back to admin review
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(ROUTES_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.key,
          // Ask only for the duration — cheapest response, no polyline/legs.
          'X-Goog-FieldMask': 'routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        }),
      });
      if (!res.ok) { this.log.warn(`Routes API HTTP ${res.status}`); return null; }
      const json = (await res.json()) as { routes?: { duration?: string }[] };
      const duration = json.routes?.[0]?.duration; // e.g. "1234s"
      if (!duration) return null;
      const seconds = Number.parseInt(duration.replace(/s$/, ''), 10);
      return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    } catch (e) {
      this.log.warn(`Routes API fetch failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A no-op provider for when traffic checks are off (returns null → every case goes to admin review). */
@Injectable()
export class NullTrafficProvider implements TrafficProvider {
  async travelTimeSec(): Promise<number | null> { return null; }
}
