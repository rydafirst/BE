import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.validation.js';
import type { GeoProvider, Prediction, ResolvedPlace } from '../ports.js';

const GOOGLE = 'https://maps.googleapis.com/maps/api';
const FETCH_TIMEOUT_MS = 8_000;

interface RawComponent { long_name: string; types: string[] }

/** Neighbourhood/locality from Google's structured components (reliable, unlike string parsing). */
function localityOf(components: RawComponent[]): string {
  const byType = (type: string) => components.find((c) => c.types.includes(type))?.long_name;
  return (
    byType('neighborhood') || byType('sublocality_level_1') || byType('sublocality') ||
    byType('locality') || byType('administrative_area_level_2') || ''
  );
}

/**
 * Google Places / Geocoding adapter for the {@link GeoProvider} port. The Maps key lives only on the
 * server (never in the app bundle, where it could be extracted and abused). Results are restricted to
 * Nigeria (`components=country:ng`). Upstream errors are logged with detail here but surfaced to
 * callers as a generic message — no key or provider internals leak to clients.
 */
@Injectable()
export class GoogleGeoProvider implements GeoProvider {
  private readonly log = new Logger(GoogleGeoProvider.name);
  private readonly key: string;

  constructor(@Inject(ENV) env: Env) {
    this.key = env.GOOGLE_MAPS_API_KEY;
  }

  get configured(): boolean {
    return this.key.length > 0;
  }

  async autocomplete(input: string, sessionToken: string): Promise<Prediction[]> {
    this.ensureConfigured();
    const q = input.trim();
    if (q.length < 2) return [];
    const url =
      `${GOOGLE}/place/autocomplete/json?input=${encodeURIComponent(q)}` +
      `&key=${this.key}&components=country:ng&language=en` +
      (sessionToken ? `&sessiontoken=${encodeURIComponent(sessionToken)}` : '');
    const json = await this.fetchJson<{
      status: string; error_message?: string;
      predictions?: { place_id: string; description: string; structured_formatting?: { main_text: string; secondary_text: string } }[];
    }>(url);
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      this.log.warn(`autocomplete ${json.status}: ${json.error_message ?? 'no message'}`);
      throw new ServiceUnavailableException('Address search is temporarily unavailable');
    }
    return (json.predictions ?? []).map((p) => ({
      placeId: p.place_id,
      description: p.description,
      primary: p.structured_formatting?.main_text ?? p.description,
      secondary: p.structured_formatting?.secondary_text ?? '',
    }));
  }

  async details(placeId: string, sessionToken: string): Promise<ResolvedPlace> {
    this.ensureConfigured();
    if (!placeId.trim()) throw new ServiceUnavailableException('Missing place id');
    const url =
      `${GOOGLE}/place/details/json?place_id=${encodeURIComponent(placeId)}` +
      `&fields=geometry,formatted_address,name,address_components&key=${this.key}` +
      (sessionToken ? `&sessiontoken=${encodeURIComponent(sessionToken)}` : '');
    const json = await this.fetchJson<{
      status: string; error_message?: string;
      result?: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string; name?: string; address_components?: RawComponent[] };
    }>(url);
    const loc = json.result?.geometry?.location;
    if (json.status !== 'OK' || !loc) {
      this.log.warn(`details ${json.status}: ${json.error_message ?? 'no location'}`);
      throw new ServiceUnavailableException('Could not resolve that address');
    }
    return {
      lat: loc.lat, lng: loc.lng,
      label: json.result?.formatted_address ?? json.result?.name ?? '',
      area: localityOf(json.result?.address_components ?? []),
    };
  }

  async reverseGeocode(lat: number, lng: number): Promise<ResolvedPlace> {
    this.ensureConfigured();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ServiceUnavailableException('Invalid coordinates');
    }
    const url = `${GOOGLE}/geocode/json?latlng=${lat},${lng}&key=${this.key}&language=en`;
    const json = await this.fetchJson<{
      status: string; error_message?: string;
      results?: { formatted_address?: string; address_components?: RawComponent[] }[];
    }>(url);
    const first = json.results?.[0];
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      this.log.warn(`reverse ${json.status}: ${json.error_message ?? 'no message'}`);
      throw new ServiceUnavailableException('Location lookup is temporarily unavailable');
    }
    return {
      lat, lng,
      label: first?.formatted_address ?? 'Current location',
      area: localityOf(first?.address_components ?? []),
    };
  }

  private ensureConfigured(): void {
    if (!this.configured) throw new ServiceUnavailableException('Address search is not configured');
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        this.log.warn(`upstream HTTP ${res.status}`);
        throw new ServiceUnavailableException('Address search is temporarily unavailable');
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.warn(`upstream fetch failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Address search is temporarily unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}
