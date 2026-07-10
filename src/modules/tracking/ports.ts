import type { GeoPoint } from '../jobs/domain/geo.js';

export interface LastKnown {
  point: GeoPoint;
  at: number;
  lastEmitAt: number;
}

/** Hot last-known location store (Redis geo in prod; short TTL — raw pings are ephemeral). */
export interface LocationStore {
  get(jobId: string): Promise<LastKnown | null>;
  set(jobId: string, value: LastKnown): Promise<void>;
}
export const LOCATION_STORE = Symbol('LOCATION_STORE');
