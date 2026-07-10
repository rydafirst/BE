import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint } from '../jobs/domain/geo.js';
import { shouldEmit } from './domain/tracking.js';
import { LOCATION_STORE, type LocationStore, type LastKnown } from './ports.js';

@Injectable()
export class TrackingService {
  constructor(@Inject(LOCATION_STORE) private readonly store: LocationStore) {}

  /** Record a rider ping; returns whether it should be broadcast (adaptive throttle). */
  async record(jobId: string, point: GeoPoint, nowMs = Date.now()): Promise<{ emitted: boolean }> {
    const prev = await this.store.get(jobId);
    const emit = shouldEmit(prev?.lastEmitAt ?? null, nowMs);
    const next: LastKnown = { point, at: nowMs, lastEmitAt: emit ? nowMs : (prev?.lastEmitAt ?? nowMs) };
    await this.store.set(jobId, next);
    return { emitted: emit };
  }

  getLastKnown(jobId: string): Promise<LastKnown | null> {
    return this.store.get(jobId);
  }
}
