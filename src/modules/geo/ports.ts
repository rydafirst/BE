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

/**
 * Routing provider port — kept separate from {@link GeoProvider} because road routing is a distinct
 * concern from geocoding (Single Responsibility / Interface Segregation). Bound to an OSRM adapter
 * today; swapping to a keyed provider (Google Directions, Mapbox, self-hosted OSRM) is an adapter
 * change only. The app never calls the routing vendor directly — only this server proxies it — so no
 * routing key can leak from the bundle.
 */
export const ROUTE_PROVIDER = Symbol('ROUTE_PROVIDER');

export interface LatLng { lat: number; lng: number }
export interface RoutePath {
  /** Ordered polyline from origin to destination, following the road network. */
  points: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteProvider {
  /** Whether routing is available (a provider is configured). */
  readonly configured: boolean;
  /** Road-following route between two points. Throws (503) if the upstream router is unavailable. */
  route(origin: LatLng, dest: LatLng): Promise<RoutePath>;
}
