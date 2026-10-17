import type { Job } from '../ports.js';

/** A place the customer has used before, surfaced the moment they tap an address field (Uber-style). */
export interface RecentPlace {
  label: string; // the full address if we have it, else the area
  area: string;  // coarse locality, may be empty
  lat: number;
  lng: number;
}

/**
 * Derive a customer's recent places from their past bookings — no separate store needed. Destinations
 * (drop-offs) lead because that's what a customer re-picks most; pickups backfill any remaining slots.
 * Deduped by ~11 m coordinate cells (4 dp), newest first, capped at `limit`.
 */
export function recentPlacesFrom(jobs: Job[], limit = 6): RecentPlace[] {
  const sorted = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seen = new Set<string>();
  const out: RecentPlace[] = [];
  const cell = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

  const add = (lat?: number, lng?: number, label?: string, area?: string): void => {
    if (out.length >= limit || lat == null || lng == null) return;
    const lbl = (label ?? area ?? '').trim();
    if (!lbl) return;
    const key = cell(lat, lng);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: lbl, area: (area ?? '').trim(), lat, lng });
  };

  for (const j of sorted) add(j.dropoff?.lat, j.dropoff?.lng, j.dropoffAddress, j.dropoffArea);
  for (const j of sorted) add(j.pickup?.lat, j.pickup?.lng, j.pickupAddress, j.pickupArea);
  return out.slice(0, limit);
}
