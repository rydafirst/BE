import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleRiders, type RiderCandidate } from './matching.js';

const pickup = { lat: 6.5, lng: 3.3 };
const near: RiderCandidate = { riderId: 'near', online: true, kycApproved: true, busy: false, pos: { lat: 6.501, lng: 3.301 } };
const far: RiderCandidate = { riderId: 'far', online: true, kycApproved: true, busy: false, pos: { lat: 6.9, lng: 3.9 } };
const offline: RiderCandidate = { riderId: 'off', online: false, kycApproved: true, busy: false, pos: pickup };
const unverified: RiderCandidate = { riderId: 'unv', online: true, kycApproved: false, busy: false, pos: pickup };
const busy: RiderCandidate = { riderId: 'bsy', online: true, kycApproved: true, busy: true, pos: pickup };

test('excludes offline, unverified, and busy riders', () => {
  const ids = eligibleRiders([offline, unverified, busy, near], pickup).map((r) => r.riderId);
  assert.deepEqual(ids, ['near']);
});
test('excludes riders outside the radius and sorts nearest first', () => {
  const ids = eligibleRiders([far, near], pickup).map((r) => r.riderId);
  assert.deepEqual(ids, ['near']);
});
