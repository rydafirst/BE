import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { recentPlacesFrom } from './recent-places.js';
import type { Job } from '../ports.js';

function job(p: Partial<Job>): Job {
  return {
    id: 'j', status: 'COMPLETED', type: 'DELIVERY', customerId: 'c', amountMinor: 1000,
    pickup: { lat: 6.5, lng: 3.3 }, dropoff: { lat: 6.6, lng: 3.4 },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...p,
  } as Job;
}

test('recent places: newest first, drop-offs lead', () => {
  const jobs = [
    job({ createdAt: '2026-01-01', dropoff: { lat: 6.60, lng: 3.40 }, dropoffAddress: 'Old place' }),
    job({ createdAt: '2026-03-01', dropoff: { lat: 6.70, lng: 3.50 }, dropoffAddress: 'New place', dropoffArea: 'Lekki' }),
  ];
  const r = recentPlacesFrom(jobs, 6);
  assert.equal(r[0]!.label, 'New place');
  assert.equal(r[0]!.area, 'Lekki');
});

test('recent places: dedupes by coordinate cell', () => {
  const jobs = [
    job({ createdAt: '2026-03-02', dropoff: { lat: 6.70001, lng: 3.50001 }, dropoffAddress: 'Same spot A' }),
    job({ createdAt: '2026-03-01', dropoff: { lat: 6.70002, lng: 3.50002 }, dropoffAddress: 'Same spot B' }),
  ];
  const r = recentPlacesFrom(jobs, 6);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.label, 'Same spot A'); // the newer wins
});

test('recent places: falls back to area when no address, skips blanks, caps at limit', () => {
  const jobs = [
    job({ createdAt: '2026-03-03', dropoff: { lat: 1, lng: 1 }, dropoffAddress: undefined, dropoffArea: 'Yaba' }),
    job({ createdAt: '2026-03-02', dropoff: { lat: 2, lng: 2 }, dropoffAddress: '  ', dropoffArea: '' , pickup: { lat: 9, lng: 9 }, pickupAddress: 'Pick A' }),
  ];
  const r = recentPlacesFrom(jobs, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0]!.label, 'Yaba');
  // the blank drop-off is skipped; a pickup backfills the second slot
  assert.equal(r[1]!.label, 'Pick A');
});
