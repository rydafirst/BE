/**
 * Rider job board: the "you earn" figure (riderPayoutMinor) must be the rider's TRUE take-home.
 * For an errand the customer's charge also carries the ITEM money (paid to the vendor, never the rider),
 * so the board must show only the DELIVERY fee net of the platform cut — not delivery + goods.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobDiscoveryService } from './job-discovery.service.js';
import type { Job, JobRepository } from './ports.js';

const PICKUP = { lat: 6.5, lng: 3.3 };
const DROPOFF = { lat: 6.52, lng: 3.33 };

function svc(jobs: Job[]): JobDiscoveryService {
  const repo = { listActive: async () => jobs } as unknown as JobRepository;
  return new JobDiscoveryService(repo);
}

test('ERRAND: the board shows only the delivery fee net of the platform fee (never the item money)', async () => {
  const errand = {
    id: 'e1', type: 'ERRAND', status: 'SEARCHING', currency: 'NGN', createdAt: new Date().toISOString(),
    amountMinor: 380_000,        // ₦3,800 = ₦3,000 goods + ₦800 delivery
    platformFeeMinor: 8_000,     // 10% of the ₦800 delivery fee
    pickup: PICKUP, dropoff: DROPOFF, pickupArea: 'Ikeja', dropoffArea: 'Yaba',
    errand: { goodsMinor: 300_000, deliveryFeeMinor: 80_000, shoppingList: 'x' },
  } as unknown as Job;

  const [row] = await svc([errand]).availableJobs();
  assert.equal(row!.riderPayoutMinor, 72_000, 'delivery ₦800 − platform ₦80 = ₦720');
  assert.notEqual(row!.riderPayoutMinor, 372_000, 'must NOT include the ₦3,000 item money');
});

test('DELIVERY: the board shows the whole charge net of the platform fee', async () => {
  const del = {
    id: 'd1', type: 'DELIVERY', status: 'SEARCHING', currency: 'NGN', createdAt: new Date().toISOString(),
    amountMinor: 280_000, platformFeeMinor: 28_000, pickup: PICKUP, dropoff: DROPOFF,
    pickupArea: 'Ikeja', dropoffArea: 'Yaba',
  } as unknown as Job;

  const [row] = await svc([del]).availableJobs();
  assert.equal(row!.riderPayoutMinor, 252_000);
});
