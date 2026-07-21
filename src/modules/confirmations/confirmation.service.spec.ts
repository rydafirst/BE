/**
 * ConfirmationService — the delivery-code contract.
 *
 * The behaviour under test is the idempotent retry: the escrow release is durable, but the HTTP
 * response can be lost (a slow external payout makes the request long enough for a mobile client to
 * time out). The rider then re-submits the SAME correct code against a now-consumed record. Before
 * this fix that returned "Invalid code" and stranded a delivery that had actually succeeded.
 *
 * The security boundary is the point of these tests: the retry path must open ONLY for a caller who
 * presents a verifying code hash, is the rider the job is assigned to, and whose job really did
 * complete. Every other path still fails closed with the same opaque message (no enumeration).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import type { Env } from '../../config/env.validation.js';
import type { JobsService } from '../jobs/jobs.service.js';
import { CODE_TTL_SECONDS, type CodeKind, type CodeRecord } from './domain/confirmation-code.js';
import { ConfirmationService } from './confirmation.service.js';
import type { ConfirmationCodeRepository } from './ports.js';

const RIDER = 'rider-1';
const JOB = 'job-1';

const hasher = new HmacHasher({ HASH_PEPPER: 'test-pepper-value' } as Env);

class FakeCodeRepo implements ConfirmationCodeRepository {
  private m = new Map<string, CodeRecord>();
  consumedCalls = 0;
  attemptCalls = 0;
  private key(jobId: string, kind: CodeKind) { return `${jobId}:${kind}`; }
  /** Synchronous seeding so test setup stays free of dangling promises. */
  seed(jobId: string, record: CodeRecord): void { this.m.set(this.key(jobId, record.kind), { ...record }); }
  async save(jobId: string, record: CodeRecord): Promise<void> { this.seed(jobId, record); }
  async find(jobId: string, kind: CodeKind): Promise<CodeRecord | null> { return this.m.get(this.key(jobId, kind)) ?? null; }
  async incrementAttempts(jobId: string, kind: CodeKind): Promise<void> {
    this.attemptCalls++;
    const r = this.m.get(this.key(jobId, kind));
    if (r) r.attempts++;
  }
  async markConsumed(jobId: string, kind: CodeKind): Promise<void> {
    this.consumedCalls++;
    const r = this.m.get(this.key(jobId, kind));
    if (r) r.consumed = true;
  }
}

/** Records how often the (expensive, money-moving) completion path is entered. */
class FakeJobs {
  completeCalls = 0;
  constructor(private readonly completedFor: { riderId: string; status: string } | null) {}
  async completeDelivery(_riderId: string, _jobId: string) {
    this.completeCalls++;
    return { status: 'RELEASED' };
  }
  async completedStatusForRider(riderId: string, _jobId: string) {
    if (!this.completedFor || this.completedFor.riderId !== riderId) return null;
    return this.completedFor.status;
  }
}

function build(opts: { record?: Partial<CodeRecord>; code?: string; completedFor?: { riderId: string; status: string } | null } = {}) {
  const repo = new FakeCodeRepo();
  const jobs = new FakeJobs(opts.completedFor ?? null);
  const svc = new ConfirmationService(hasher, jobs as unknown as JobsService, repo);
  const code = opts.code ?? '4821';
  repo.seed(JOB, {
    kind: 'DELIVERY',
    codeHash: hasher.hash(code),
    createdAtMs: Date.now(),
    attempts: 0,
    consumed: false,
    ...opts.record,
  });
  return { svc, repo, jobs, code };
}

async function rejects(fn: () => Promise<unknown>): Promise<void> {
  await assert.rejects(fn, (e: unknown) => {
    assert.ok(e instanceof UnauthorizedException, 'expected UnauthorizedException');
    // Opaque, identical message on every failure path — no enumeration of why it failed.
    assert.equal((e as UnauthorizedException).message, 'Invalid code');
    return true;
  });
}

test('correct code on a live record completes the delivery and burns the code', async () => {
  const { svc, repo, jobs, code } = build();
  const res = await svc.confirmDelivery(RIDER, JOB, code);
  assert.equal(res.status, 'RELEASED');
  assert.equal(jobs.completeCalls, 1);
  assert.equal(repo.consumedCalls, 1);
  assert.equal(repo.attemptCalls, 0);
});

test('replaying the correct code after a successful confirm returns the status, not an error', async () => {
  const { svc, jobs, code } = build({
    record: { consumed: true },
    completedFor: { riderId: RIDER, status: 'RELEASED' },
  });
  const res = await svc.confirmDelivery(RIDER, JOB, code);
  assert.equal(res.status, 'RELEASED');
  // Critically: the money path is NOT re-entered on a replay.
  assert.equal(jobs.completeCalls, 0);
});

test('replay is also accepted while the job sits at COMPLETED (release not yet finalised)', async () => {
  const { svc, code } = build({
    record: { consumed: true },
    completedFor: { riderId: RIDER, status: 'COMPLETED' },
  });
  assert.equal((await svc.confirmDelivery(RIDER, JOB, code)).status, 'COMPLETED');
});

test('a different rider cannot use the replay path even with the correct code', async () => {
  const { svc, code } = build({
    record: { consumed: true },
    completedFor: { riderId: RIDER, status: 'RELEASED' },
  });
  await rejects(() => svc.confirmDelivery('rider-2', JOB, code));
});

test('replay is refused when the job did not actually complete', async () => {
  const { svc, code } = build({ record: { consumed: true }, completedFor: null });
  await rejects(() => svc.confirmDelivery(RIDER, JOB, code));
});

test('a wrong code on a consumed record is still rejected and is counted', async () => {
  const { svc, repo, jobs } = build({
    record: { consumed: true },
    completedFor: { riderId: RIDER, status: 'RELEASED' },
  });
  await rejects(() => svc.confirmDelivery(RIDER, JOB, '0000'));
  assert.equal(jobs.completeCalls, 0);
  // A burned code must not become an unmetered guessing oracle.
  assert.equal(repo.attemptCalls, 1);
});

test('a wrong code on a live record is rejected and counted', async () => {
  const { svc, repo } = build();
  await rejects(() => svc.confirmDelivery(RIDER, JOB, '0000'));
  assert.equal(repo.attemptCalls, 1);
});

test('an exhausted record is rejected even with the correct code', async () => {
  const { svc, code } = build({ record: { attempts: 99 } });
  await rejects(() => svc.confirmDelivery(RIDER, JOB, code));
});

test('an expired record is rejected, and a correct code is not counted as a wrong guess', async () => {
  const { svc, repo, code } = build({ record: { createdAtMs: Date.now() - (CODE_TTL_SECONDS + 60) * 1000 } });
  await rejects(() => svc.confirmDelivery(RIDER, JOB, code));
  assert.equal(repo.attemptCalls, 0);
});

test('a job with no issued code is rejected without leaking that fact', async () => {
  const repo = new FakeCodeRepo();
  const svc = new ConfirmationService(hasher, new FakeJobs(null) as unknown as JobsService, repo);
  await rejects(() => svc.confirmDelivery(RIDER, 'no-such-job', '1234'));
});
