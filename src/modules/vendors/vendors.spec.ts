/**
 * Vendor onboarding through the REAL VendorsService.
 *
 * Proves:
 *   - one vendor per owner; registration starts PENDING and not sellable;
 *   - a business account is name-matched (auto-verified on a clear match) and never leaks the raw key;
 *   - admin approval requires a captured account, then flips the vendor APPROVED (live);
 *   - public browse only ever returns APPROVED vendors and their AVAILABLE products.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VendorsService } from './vendors.service.js';
import { InMemoryProductRepo, InMemoryVendorRepo } from './adapters/in-memory-vendor.repo.js';

function build(resolvedName = 'SOLASHINE VENTURES LTD') {
  const store = {
    async presignPut(key: string) { return { uploadUrl: `https://up/${key}`, key }; },
    async signedGetUrl(key: string) { return `https://get/${key}`; },
    async remove() { /* noop */ },
  };
  const escrow = { async resolveAccount() { return { accountName: resolvedName }; } };
  const notify = { async record() { /* noop */ } };
  const svc = new VendorsService(
    new InMemoryVendorRepo(), new InMemoryProductRepo(),
    store as unknown as never, escrow as unknown as never, notify as unknown as never,
  );
  return { svc };
}

test('register: one vendor per owner, starts PENDING', async () => {
  const { svc } = build();
  const v = await svc.register('user-1', { businessName: 'Sola Store' });
  assert.equal(v.status, 'PENDING');
  assert.equal(v.accountVerified, false);
  await assert.rejects(svc.register('user-1', { businessName: 'Second Shop' }), 'cannot register twice');
});

test('business account: name-match auto-verifies; raw key never leaks; approval needs an account', async () => {
  const { svc } = build('SOLASHINE VENTURES LTD');
  const v = await svc.register('user-2', { businessName: 'Solashine Ventures' });

  // Cannot approve before an account is captured.
  await assert.rejects(svc.approve(v.id), 'approval blocked without a business account');

  const res = await svc.captureBusinessAccount('user-2', '058', '0123456789');
  assert.equal(res.match, true, 'resolved name matches the business');
  const mine = (await svc.getMine('user-2'))!;
  assert.equal(mine.accountVerified, true);
  assert.equal(mine.account?.accountName, 'SOLASHINE VENTURES LTD');

  const approved = await svc.approve(v.id);
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.approvedAt && approved.approvedAt > 0);
});

test('browse: only APPROVED vendors and AVAILABLE products are public', async () => {
  const { svc } = build();
  // A pending vendor is invisible to browse and to getPublic.
  const pending = await svc.register('user-3', { businessName: 'Pending Shop' });
  assert.equal((await svc.listApproved()).length, 0);
  await assert.rejects(svc.getPublic(pending.id));

  // Approve it, add two products (one hidden), and confirm the public catalog hides the unavailable one.
  await svc.captureBusinessAccount('user-3', '058', '0123456789');
  await svc.approve(pending.id);
  await svc.addProduct('user-3', { name: 'Jollof pack', priceMinor: 250000 });
  await svc.addProduct('user-3', { name: 'Secret item', priceMinor: 500000, available: false });

  const list = await svc.listApproved();
  assert.equal(list.length, 1);
  const pub = await svc.listVendorProducts(pending.id);
  assert.equal(pub.length, 1, 'only the available product is public');
  assert.equal(pub[0]!.name, 'Jollof pack');

  // The owner still sees all their own products.
  assert.equal((await svc.listMyProducts('user-3')).length, 2);
});

test('reject: sets REJECTED with a reason', async () => {
  const { svc } = build();
  const v = await svc.register('user-4', { businessName: 'No KYC Shop' });
  const rejected = await svc.reject(v.id, 'Business name does not match the account');
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.rejectionReason, 'Business name does not match the account');
});
