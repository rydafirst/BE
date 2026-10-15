/**
 * STICKY ROLE — an account's role is fixed at creation and never changes on login.
 *
 * Whatever a phone number first registers as (CUSTOMER or RIDER) is what it stays. Signing in,
 * logging out, and signing back in — even explicitly requesting the other role — can never flip it.
 * The one exception is an allowlisted ADMIN, which is provisioned at the auth-service layer, not here.
 *
 * We exercise the InMemoryUserRepo directly (the same upsertByPhone contract the Prisma repo implements).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryUserRepo } from './adapters/in-memory.adapters.js';

test('a customer stays a customer no matter what role later logins request', async () => {
  const repo = new InMemoryUserRepo();
  const created = await repo.upsertByPhone('+2348000000001', 'CUSTOMER', undefined, 'Ada');
  assert.equal(created.role, 'CUSTOMER');

  // Later "sign in as a rider" attempts must be ignored.
  const again = await repo.upsertByPhone('+2348000000001', 'RIDER');
  assert.equal(again.id, created.id, 'same account');
  assert.equal(again.role, 'CUSTOMER', 'role did not flip to RIDER');

  const andAgain = await repo.upsertByPhone('+2348000000001', 'RIDER');
  assert.equal(andAgain.role, 'CUSTOMER', 'still a customer after another login');
});

test('a rider stays a rider no matter what role later logins request', async () => {
  const repo = new InMemoryUserRepo();
  const created = await repo.upsertByPhone('+2348000000002', 'RIDER', undefined, 'Chidi');
  assert.equal(created.role, 'RIDER');

  const again = await repo.upsertByPhone('+2348000000002', 'CUSTOMER');
  assert.equal(again.id, created.id, 'same account');
  assert.equal(again.role, 'RIDER', 'role did not flip to CUSTOMER');
});

test('the role a phone first registers with is the one it keeps', async () => {
  const repo = new InMemoryUserRepo();
  // First contact decides the role for good.
  const asRider = await repo.upsertByPhone('+2348000000003', 'RIDER');
  assert.equal(asRider.role, 'RIDER');
  // A subsequent customer-side login on the same number keeps the rider role.
  const stillRider = await repo.upsertByPhone('+2348000000003', 'CUSTOMER');
  assert.equal(stillRider.role, 'RIDER');
});
