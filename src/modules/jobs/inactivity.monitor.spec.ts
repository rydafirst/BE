/**
 * The monitor sends unsolicited notifications on a timer, so the tests are mostly about NOT sending:
 * once per stage at most, never on a stale reading, never for a job that has already moved on.
 * A duplicate here is not a cosmetic bug — it is the app waking a rider repeatedly while they ride.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InactivityMonitor } from './inactivity.monitor.js';
import type { JobStatus } from './domain/job-state-machine.js';
import type { JobStatusLog } from './status-log.port.js';
import type { JobRepository, Job } from './ports.js';
import type { NotificationOutbox } from '../notifications/ports.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

const MIN = 60_000;
const NOW = 1_700_000_000_000;

class FakeOutbox implements NotificationOutbox {
  keys = new Set<string>();
  async seen(k: string) { return this.keys.has(k); }
  async mark(k: string) { this.keys.add(k); }
}

function build(opts: {
  candidates: Array<{ jobId: string; status: JobStatus; at: number }>;
  job: Partial<Job> | null;
}) {
  const sent: Array<{ userId: string; title: string; urgent?: boolean }> = [];
  const outbox = new FakeOutbox();
  const statusLog = { async stalledSince() { return opts.candidates; } } as unknown as JobStatusLog;
  const jobs = {
    async find() { return opts.job ? ({ id: 'job-1', riderId: 'rider-1', ...opts.job } as Job) : null; },
  } as unknown as JobRepository;
  const notify = {
    async record(userId: string, n: { title: string; urgent?: boolean }) { sent.push({ userId, ...n }); },
  } as unknown as NotificationsService;
  return { monitor: new InactivityMonitor(statusLog, jobs, outbox, notify), sent, outbox };
}

const stalled = (status: JobStatus, agoMin: number) => [{ jobId: 'job-1', status, at: NOW - agoMin * MIN }];

test('nudges a rider who has sat in a stage past its threshold', async () => {
  const { monitor, sent } = build({ candidates: stalled('ARRIVED', 15), job: { status: 'ARRIVED' } });
  assert.equal(await monitor.scan(NOW), 1);
  assert.equal(sent[0]?.userId, 'rider-1');
  assert.equal(sent[0]?.urgent, true, 'a nudge that does not ring is pointless');
});

test('never nudges twice for the same stage', async () => {
  const { monitor, sent } = build({ candidates: stalled('ARRIVED', 15), job: { status: 'ARRIVED' } });
  assert.equal(await monitor.scan(NOW), 1);
  assert.equal(await monitor.scan(NOW + MIN), 0, 'the outbox must suppress the repeat');
  assert.equal(sent.length, 1);
});

test('respects the per-stage threshold, not just the scan floor', async () => {
  // 6 minutes is past the global floor but well short of ARRIVED's own 10-minute threshold.
  const { monitor, sent } = build({ candidates: stalled('ARRIVED', 6), job: { status: 'ARRIVED' } });
  assert.equal(await monitor.scan(NOW), 0);
  assert.equal(sent.length, 0);
});

test('does not nudge when the job has already moved on since the log was read', async () => {
  // The append-only log can lag the job; acting on a stale reading would nag a rider who is fine.
  const { monitor, sent } = build({ candidates: stalled('ARRIVED', 30), job: { status: 'RELEASED' } });
  assert.equal(await monitor.scan(NOW), 0);
  assert.equal(sent.length, 0);
});

test('does not nudge a job with no rider, or one that has vanished', async () => {
  const noRider = build({ candidates: stalled('ARRIVED', 30), job: { status: 'ARRIVED', riderId: undefined } });
  assert.equal(await noRider.monitor.scan(NOW), 0);
  const gone = build({ candidates: stalled('ARRIVED', 30), job: null });
  assert.equal(await gone.monitor.scan(NOW), 0);
});

test('a stage that is deliberately excluded is never nudged', async () => {
  // The rider is being paid to wait here; interrupting them would be wrong.
  const { monitor } = build({ candidates: stalled('WAITING', 120), job: { status: 'WAITING' } });
  assert.equal(await monitor.scan(NOW), 0);
});

test('a failing scan is contained rather than thrown at the timer', async () => {
  const statusLog = { async stalledSince() { throw new Error('db down'); } } as unknown as JobStatusLog;
  const monitor = new InactivityMonitor(
    statusLog, {} as JobRepository, new FakeOutbox(), {} as NotificationsService,
  );
  assert.equal(await monitor.scan(NOW), 0); // resolves, does not reject
});
