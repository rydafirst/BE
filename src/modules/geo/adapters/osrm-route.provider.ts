import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { LatLng, RoutePath, RouteProvider } from '../ports.js';

const FETCH_TIMEOUT_MS = 6_000;

/** Shape of the slice of the OSRM `/route` response we consume. */
interface OsrmResponse {
  code?: string;
  routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[];
}

/**
 * Parse an OSRM `/route/v1` response into our {@link RoutePath}. PURE (no I/O) so the mapping —
 * including OSRM's `[lng, lat]` ordering, which is the classic place to introduce a swapped-axis bug —
 * is unit-tested in isolation. Throws on any malformed or empty result so callers fail closed.
 */
export function parseOsrmRoute(json: OsrmResponse): RoutePath {
  if (json.code !== 'Ok') throw new Error(`OSRM status ${json.code ?? 'unknown'}`);
  const route = json.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (!route || !Array.isArray(coords) || coords.length < 2) throw new Error('OSRM returned no geometry');
  const points: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
  return {
    points,
    distanceMeters: Math.max(0, Math.round(route.distance ?? 0)),
    durationSeconds: Math.max(0, Math.round(route.duration ?? 0)),
  };
}

/**
 * OSRM routing adapter for the {@link RouteProvider} port. Keyless by default (the public OSRM demo
 * server), so nothing secret ships in the app; `OSRM_BASE_URL` lets you point at a self-hosted OSRM
 * for production scale without any code change. Upstream failures are logged with detail here but
 * surfaced to callers as a generic 503 — the app then draws a straight-line fallback.
 */
@Injectable()
export class OsrmRouteProvider implements RouteProvider {
  private readonly log = new Logger(OsrmRouteProvider.name);
  private readonly baseUrl: string;

  constructor(@Inject(ENV) env: Env) {
    this.baseUrl = env.OSRM_BASE_URL.replace(/\/+$/, '');
  }

  /** OSRM is keyless, so routing is always available (subject to the upstream being reachable). */
  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  async route(origin: LatLng, dest: LatLng): Promise<RoutePath> {
    for (const p of [origin, dest]) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
        throw new ServiceUnavailableException('Invalid coordinates');
      }
    }
    // Coordinates are formatted as fixed-precision numbers (never raw strings), so nothing user-typed
    // is interpolated into the upstream URL. OSRM wants lng,lat order.
    const o = `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`;
    const d = `${dest.lng.toFixed(6)},${dest.lat.toFixed(6)}`;
    const url = `${this.baseUrl}/route/v1/driving/${o};${d}?overview=full&geometries=geojson`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        this.log.warn(`upstream HTTP ${res.status}`);
        throw new ServiceUnavailableException('Routing is temporarily unavailable');
      }
      return parseOsrmRoute((await res.json()) as OsrmResponse);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.warn(`route failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Routing is temporarily unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}
