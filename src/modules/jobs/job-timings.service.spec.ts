/**
 * Timings look like harmless metadata, but they describe the rhythm of someone's working day —
 * when they were standing at a door, how long they waited. So the tests here are mostly about who
 * is allowed to read them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobTimingsService } from './job-timings.service.js';
import type { JobStatusLog } from './status-log.port.js';
import type { Job, JobRepository } from './ports.js';
import type { StatusEvent } from './domain/stage-timing.js';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const EVENTS: StatusEvent[] = [
  { status: 'ACCEPTED', at: T0 },
  { status: 'EN_ROUTE_PICKUP', at: T0 + 3 * MIN },
  { status: 'AT_PICKUP', at: T0 + 13 * MIN },
];

function build(job: Partial<Job> | null, events: StatusEvent[] = EVENTS) {
  const statusLog = { async list() { return events; } } as unknown as JobStatusLog;
  const jobs = {
    async find() { return job ? ({ id: 'job-1', customerId: 'cust-1', riderId: 'rider-1', ...job } as Job) : null; },
  } as unknown as JobRepository;
  return new JobTimingsService(statusLog, jobs);
}

test('the customer can read the timings for their own delivery', async () => {
  const r = await build({}).forJob('cust-1', 'job-1', T0 + 20 * MIN);
  assert.deepEqual(r.stages.map((s) => [s.status, s.ms / MIN]), [
    ['ACCEPTED', 3], ['EN_ROUTE_PICKUP', 10], ['AT_PICKUP', 7],
  ]);
});

test('the assigned rider can read them too', async () => {
  const r = await build({}).forJob('rider-1', 'job-1', T0 + 20 * MIN);
  assert.equal(r.stages.length, 3);
});

test('the open stage and the total are reported alongside the breakdown', async () => {
  const r = await build({}).forJob('cust-1', 'job-1', T0 + 20 * MIN);
  assert.equal(r.currentStageMs, 7 * MIN);
  assert.equal(r.totalMs, 20 * MIN);
  assert.deepEqual(r.stages.filter((s) => s.open).map((s) => s.status), ['AT_PICKUP']);
});

test('a stranger cannot read someone else’s delivery timings', async () => {
  await assert.rejects(() => build({}).forJob('someone-else', 'job-1'), ForbiddenException);
});

test('a rider who is not on this job cannot read them', async () => {
  await assert.rejects(() => build({ riderId: 'other-rider' }).forJob('rider-1', 'job-1'), ForbiddenException);
});

test('a missing job is a 404, not an empty timing set', async () => {
  await assert.rejects(() => build(null).forJob('cust-1', 'nope'), NotFoundException);
});

test('a job with no recorded history returns empty timings rather than failing', async () => {
  // Jobs created before the status log existed have no events; the screen must still render.
  const r = await build({}, []).forJob('cust-1', 'job-1', T0);
  assert.deepEqual(r, { stages: [], currentStageMs: 0, totalMs: 0 });
});
