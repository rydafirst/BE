/**
 * The lateness monitor sends unsolicited alerts on a timer, so — like the inactivity monitor — the
 * tests are mostly about NOT over-sending: once per tier at most, only past the right threshold, and
 * never once the job has moved on. It must also never do anything but notify (no money can move).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatenessMonitor } from './lateness.monitor.js';
import type { JobStatus } from './domain/job-state-machine.js';
import type { StatusEvent } from './domain/stage-timing.js';
import type { JobStatusLog } from './status-log.port.js';
import type { JobRepository, Job } from './ports.js';
import type { NotificationOutbox } from '../notifications/ports.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

const NOW = 1_700_000_000_000;
// pickup==dropoff -> 0 distance -> ETA floored to 1 min -> expectedSec = 60. So: rider at 90s, all at 120s.
const SAME = { lat: 6.5, lng: 3.3 };

class FakeOutbox implements NotificationOutbox {
  keys = new Set<string>();
  async seen(k: string) { return this.keys.has(k); }
  async mark(k: string) { this.keys.add(k); }
}

function build(opts: { status: JobStatus; pickupAgoSec?: number; pickedUp?: boolean; job?: Partial<Job> | null }) {
  const pickupAt = NOW - (opts.pickupAgoSec ?? 0) * 1000;
  const events: StatusEvent[] = opts.pickedUp === false
    ? [{ status: 'ACCEPTED', at: pickupAt }]
    : [{ status: 'ACCEPTED', at: pickupAt - 1000 }, { status: 'IN_PROGRESS', at: pickupAt }];
  const candidates = [{ jobId: 'job-1', status: opts.status, at: pickupAt }];
  const statusLog = { async stalledSince() { return candidates; }, async list() { return events; } } as unknown as JobStatusLog;
  const base: Partial<Job> = { id: 'job-1', riderId: 'rider-1', customerId: 'cust-1', status: opts.status, pickup: SAME, dropoff: SAME };
  const job = opts.job === null ? null : ({ ...base, ...opts.job } as Job);
  const jobs = { async find() { return job; } } as unknown as JobRepository;
  const sent: Array<{ userId: string; title: string; urgent?: boolean }> = [];
  const notify = { async record(userId: string, n: { title: string; urgent?: boolean }) { sent.push({ userId, ...n }); } } as unknown as NotificationsService;
  const outbox = new FakeOutbox();
  return { monitor: new LatenessMonitor(statusLog, jobs, outbox, notify), sent, outbox };
}

test('rider tier (>=1.5x ETA): nudges the rider only', async () => {
  const { monitor, sent } = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 100 });
  assert.equal(await monitor.scan(NOW), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.userId, 'rider-1');
  assert.equal(sent[0]?.urgent, true);
});

test('escalate tier (>=2x ETA): nudges the rider AND the customer', async () => {
  const { monitor, sent } = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 200 });
  assert.equal(await monitor.scan(NOW), 2);
  assert.deepEqual(sent.map((s) => s.userId).sort(), ['cust-1', 'rider-1']);
});

test('on time (<1.5x ETA): nobody is alerted', async () => {
  const { monitor, sent } = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 50 });
  assert.equal(await monitor.scan(NOW), 0);
  assert.equal(sent.length, 0);
});

test('each tier fires at most once per delivery', async () => {
  const { monitor, sent } = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 200 });
  assert.equal(await monitor.scan(NOW), 2);
  assert.equal(await monitor.scan(NOW + 60_000), 0, 'the outbox must suppress repeats');
  assert.equal(sent.length, 2);
});

test('a job that has already moved on is not alerted', async () => {
  const { monitor, sent } = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 200, job: { status: 'RELEASED' } });
  assert.equal(await monitor.scan(NOW), 0);
  assert.equal(sent.length, 0);
});

test('a job with no rider, or one that vanished, is not alerted', async () => {
  const noRider = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 200, job: { riderId: undefined } });
  assert.equal(await noRider.monitor.scan(NOW), 0);
  const gone = build({ status: 'EN_ROUTE_DROP', pickupAgoSec: 200, job: null });
  assert.equal(await gone.monitor.scan(NOW), 0);
});

test('a job not actually picked up (no IN_PROGRESS event) is not alerted', async () => {
  const { monitor, sent } = build({ status: 'IN_PROGRESS', pickupAgoSec: 200, pickedUp: false });
  assert.equal(await monitor.scan(NOW), 0);
  assert.equal(sent.length, 0);
});

test('a failing scan is contained, not thrown at the timer', async () => {
  const statusLog = { async stalledSince() { throw new Error('db down'); } } as unknown as JobStatusLog;
  const monitor = new LatenessMonitor(statusLog, {} as JobRepository, new FakeOutbox(), {} as NotificationsService);
  assert.equal(await monitor.scan(NOW), 0);
});
