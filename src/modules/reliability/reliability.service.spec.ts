/**
 * ReliabilityService through the REAL in-memory repo, with a controllable fake traffic provider.
 * Proves the fair auto-judge (traffic excuses / clearly-late strikes / uncertain-to-admin), the
 * 3-strikes suspension gate, admin uphold/waive, and the money-forfeit switch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReliabilityService, type LateReportInput } from './reliability.service.js';
import { InMemoryReliabilityRepo } from './adapters/in-memory-reliability.repo.js';
import type { TrafficProvider } from './traffic.port.js';

const PICKUP = { lat: 6.5, lng: 3.3 };
const DROPOFF = { lat: 6.52, lng: 3.33 };

function build(opts: { trafficSec: number | null; moneyOn?: boolean }) {
  const repo = new InMemoryReliabilityRepo();
  const traffic: TrafficProvider = { async travelTimeSec() { return opts.trafficSec; } };
  const notify = { record: async () => {} } as unknown as never;
  const settings = { lateMoneyPenaltyEnabled: async () => !!opts.moneyOn } as unknown as never;
  const svc = new ReliabilityService(repo, traffic, notify, settings);
  return { svc, repo };
}

const input = (over: Partial<LateReportInput> = {}): LateReportInput => ({
  jobId: 'j1', riderId: 'r1', reporterId: 'c1',
  actualSec: 24 * 60, staticEtaSec: 15 * 60, pickup: PICKUP, dropoff: DROPOFF, deliveryFeeMinor: 280_000,
  ...over,
});

test('traffic explains the delay → dismissed, no strike', async () => {
  const { svc, repo } = build({ trafficSec: 20 * 60 }); // traffic said 20 min; rider took 24 → within tolerance
  const r = await svc.reportLate(input({ actualSec: 24 * 60 }));
  assert.equal(r.verdict, 'ON_TIME');
  assert.equal(r.status, 'DISMISSED');
  assert.equal((await repo.listStrikes('r1')).length, 0);
});

test('clearly late beyond traffic → upheld + a strike', async () => {
  const { svc, repo } = build({ trafficSec: 20 * 60 });
  const r = await svc.reportLate(input({ actualSec: 40 * 60 })); // 2x the traffic estimate
  assert.equal(r.verdict, 'LATE');
  assert.equal(r.status, 'UPHELD');
  assert.equal((await repo.listStrikes('r1')).length, 1);
});

test('no traffic estimate → uncertain, goes to the admin queue (no auto-strike)', async () => {
  const { svc, repo } = build({ trafficSec: null });
  const r = await svc.reportLate(input({ actualSec: 60 * 60 }));
  assert.equal(r.verdict, 'UNCERTAIN');
  assert.equal(r.status, 'PENDING');
  assert.equal((await repo.listStrikes('r1')).length, 0);
  assert.equal((await svc.listPending()).length, 1);
});

test('3 strikes → suspension, and a suspended rider is blocked from accepting', async () => {
  const { svc } = build({ trafficSec: 20 * 60 });
  for (let i = 0; i < 3; i += 1) await svc.reportLate(input({ jobId: `j${i}`, actualSec: 40 * 60 }));
  const until = await svc.currentSuspensionUntil('r1');
  assert.ok(until && until > Date.now());
  await assert.rejects(svc.assertNotSuspended('r1'), /suspended/i);
  await svc.liftSuspension('r1');
  assert.equal(await svc.currentSuspensionUntil('r1'), null);
});

test('money switch on → the 10% forfeit is recorded on an upheld late trip', async () => {
  const { svc, repo } = build({ trafficSec: 20 * 60, moneyOn: true });
  const r = await svc.reportLate(input({ actualSec: 40 * 60, deliveryFeeMinor: 280_000 }));
  const report = await repo.findReport(r.reportId);
  assert.equal(report?.forfeitMinor, 28_000); // 10% of ₦2,800
});

test('admin uphold adds a strike; waive does not', async () => {
  const a = build({ trafficSec: null });
  const rep = await a.svc.reportLate(input()); // UNCERTAIN → PENDING
  await a.svc.uphold(rep.reportId, 'admin1');
  assert.equal((await a.repo.listStrikes('r1')).length, 1);

  const b = build({ trafficSec: null });
  const rep2 = await b.svc.reportLate(input());
  await b.svc.waive(rep2.reportId, 'admin1');
  assert.equal((await b.repo.listStrikes('r1')).length, 0);
});
