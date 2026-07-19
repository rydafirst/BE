/**
 * Geo provider port. The controller depends on this abstraction, never on a concrete map vendor, so
 * swapping Google for another provider (Mapbox, HERE, a self-hosted geocoder) is an adapter change
 * only — no edits to the controller or the rest of the app (Dependency Inversion / Open-Closed).
 */
export const GEO_PROVIDER = Symbol('GEO_PROVIDER');

export interface Prediction { placeId: string; description: string; primary: string; secondary: string }
export interface ResolvedPlace { lat: number; lng: number; label: string; area: string }

export interface GeoProvider {
  /** Whether address search is available (a provider key is configured). */
  readonly configured: boolean;
  /** Autocomplete predictions for a typed query (results restricted to the operating country). */
  autocomplete(input: string, sessionToken: string): Promise<Prediction[]>;
  /** Resolve a chosen prediction to coordinates + a locality label. */
  details(placeId: string, sessionToken: string): Promise<ResolvedPlace>;
  /** Reverse-geocode a GPS fix into a formatted address + locality. */
  reverseGeocode(lat: number, lng: number): Promise<ResolvedPlace>;
}
