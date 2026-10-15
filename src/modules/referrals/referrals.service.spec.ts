/**
 * REFERRALS — rider-to-rider, paid after the referred rider's first delivery, admin-credited.
 *
 * Proves the rules that matter: a code binds exactly one new rider to one referrer; you can't refer
 * yourself, use a bad code, or be referred twice; a code can't be attached after you've started
 * delivering; crediting is gated on a completed delivery, pays the referrer exactly once (idempotent),
 * and refuses when there's no payout account; rejection is terminal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { ReferralsService } from './referrals.service.js';
import { InMemoryReferralRepo } from './adapters/in-memory-referral.repo.js';
import { InMemoryUserRepo } from '../auth/adapters/in-memory.adapters.js';
import type { JobStatus } from '../jobs/domain/job-state-machine.js';

type Harness = {
  svc: ReferralsService;
  users: InMemoryUserRepo;
  setDeliveries: (riderId: string, statuses: JobStatus[]) => void;
  setPayout: (riderId: string, has: boolean) => void;
  transfers: string[]; // references of transfers issued
};

function make(rewardMinor = 100_000): Harness {
  const users = new InMemoryUserRepo();
  const repo = new InMemoryReferralRepo();
  const deliveries = new Map<string, JobStatus[]>();
  const payouts = new Map<string, boolean>();
  const transfers: string[] = [];

  const jobs = { jobsForRider: async (riderId: string) => (deliveries.get(riderId) ?? []).map((status) => ({ status })) } as never;
  const settings = { referralRewardMinor: async () => rewardMinor } as never;
  const payout = { getPayout: async (riderId: string) => (payouts.get(riderId) ? { bankCode: '044', accountNumber: '0000000000' } : null) } as never;
  const provider = {
    transfer: async (p: { reference: string }) => { transfers.push(p.reference); return { providerRef: `ref_${transfers.length}` }; },
  } as never;

  const svc = new ReferralsService(repo, users as never, jobs, settings, payout, provider);
  return {
    svc, users, transfers,
    setDeliveries: (id, s) => deliveries.set(id, s),
    setPayout: (id, has) => payouts.set(id, has),
  };
}

async function seedRider(users: InMemoryUserRepo, phone: string): Promise<string> {
  const { id } = await users.upsertByPhone(phone, 'RIDER', undefined, `R${phone.slice(-3)}`);
  return id;
}

test('a new rider can claim a referrer’s code, binding one referral', async () => {
  const h = make();
  const referrer = await seedRider(h.users, '+2347000000001');
  const referee = await seedRider(h.users, '+2347000000002');
  const { code } = await h.svc.mine(referrer); // generates the referrer's code

  const r = await h.svc.claim(referee, code.toLowerCase()); // case-insensitive
  assert.deepEqual(r, { ok: true });

  const list = (await h.svc.adminList()).items;
  assert.equal(list.length, 1);
  assert.equal(list[0]!.referrer.id, referrer);
  assert.equal(list[0]!.referee.id, referee);
  assert.equal(list[0]!.status, 'PENDING');
  assert.equal(list[0]!.qualified, false); // no delivery yet
});

test('self-referral, unknown code, and double referral are refused', async () => {
  const h = make();
  const referrer = await seedRider(h.users, '+2347000000011');
  const referee = await seedRider(h.users, '+2347000000012');
  const other = await seedRider(h.users, '+2347000000013');
  const { code } = await h.svc.mine(referrer);
  const { code: otherCode } = await h.svc.mine(other);

  await assert.rejects(() => h.svc.claim(referrer, code), BadRequestException); // own code
  await assert.rejects(() => h.svc.claim(referee, 'ZZZZZZ'), BadRequestException); // unknown

  await h.svc.claim(referee, code);
  // A second DIFFERENT code on the same account is refused; re-submitting the SAME one is a no-op.
  await assert.rejects(() => h.svc.claim(referee, otherCode), ConflictException);
  assert.deepEqual(await h.svc.claim(referee, code), { ok: true });
});

test('a code cannot be attached once the rider has already delivered', async () => {
  const h = make();
  const referrer = await seedRider(h.users, '+2347000000021');
  const referee = await seedRider(h.users, '+2347000000022');
  const { code } = await h.svc.mine(referrer);
  h.setDeliveries(referee, ['RELEASED']); // already delivering
  await assert.rejects(() => h.svc.claim(referee, code), ConflictException);
});

test('crediting is gated on a first delivery, pays once, and is idempotent', async () => {
  const h = make(100_000);
  const referrer = await seedRider(h.users, '+2347000000031');
  const referee = await seedRider(h.users, '+2347000000032');
  const { code } = await h.svc.mine(referrer);
  await h.svc.claim(referee, code);
  const id = (await h.svc.adminList()).items[0]!.id;

  // Not qualified yet.
  await assert.rejects(() => h.svc.credit(id, 'admin1'), ConflictException);

  // Referred rider completes a delivery → qualified. Referrer has a payout account.
  h.setDeliveries(referee, ['COMPLETED']);
  h.setPayout(referrer, true);

  const credited = await h.svc.credit(id, 'admin1');
  assert.equal(credited.status, 'CREDITED');
  assert.equal(credited.rewardMinor, 100_000);
  assert.equal(h.transfers.length, 1, 'paid exactly once');
  assert.equal(h.transfers[0], `referral:${id}`, 'stable reference');

  // Idempotent: crediting again neither double-pays nor changes the row.
  const again = await h.svc.credit(id, 'admin2');
  assert.equal(again.status, 'CREDITED');
  assert.equal(h.transfers.length, 1, 'no second transfer');
});

test('crediting refuses when the referrer has no payout account', async () => {
  const h = make();
  const referrer = await seedRider(h.users, '+2347000000041');
  const referee = await seedRider(h.users, '+2347000000042');
  const { code } = await h.svc.mine(referrer);
  await h.svc.claim(referee, code);
  const id = (await h.svc.adminList()).items[0]!.id;
  h.setDeliveries(referee, ['COMPLETED']); // qualified
  // no payout set for referrer
  await assert.rejects(() => h.svc.credit(id, 'admin1'), ConflictException);
  assert.equal(h.transfers.length, 0);
});

test('a rejected referral is terminal and cannot be credited', async () => {
  const h = make();
  const referrer = await seedRider(h.users, '+2347000000051');
  const referee = await seedRider(h.users, '+2347000000052');
  const { code } = await h.svc.mine(referrer);
  await h.svc.claim(referee, code);
  const id = (await h.svc.adminList()).items[0]!.id;

  const rejected = await h.svc.reject(id, 'admin1');
  assert.equal(rejected.status, 'REJECTED');
  h.setDeliveries(referee, ['COMPLETED']);
  h.setPayout(referrer, true);
  await assert.rejects(() => h.svc.credit(id, 'admin1'), ConflictException);
});

test('mine() returns a stable code, a rider-signup link, and running totals', async () => {
  const h = make(100_000);
  const referrer = await seedRider(h.users, '+2347000000061');
  const first = await h.svc.mine(referrer);
  const second = await h.svc.mine(referrer);
  assert.equal(first.code, second.code, 'code is stable across calls');
  assert.match(first.link, /\/login\?role=rider&ref=/);
  assert.equal(first.rewardMinor, 100_000);
  assert.equal(first.invited, 0);
});
