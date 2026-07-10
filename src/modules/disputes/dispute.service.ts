import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JobsService } from '../jobs/jobs.service.js';
import { IdentityService } from '../identity/domain/identity.service.js';
import type { JobStatus } from '../jobs/domain/job-state-machine.js';
import { autoResolve, type EvidenceSignals, type Resolution } from './domain/dispute.js';
import { DISPUTE_REPO, type DisputeRecord, type DisputeRepository } from './ports.js';

const REACHED = new Set<JobStatus>(['ARRIVED', 'AWAITING_CODE', 'COMPLETED', 'FAILED_ATTEMPT']);

@Injectable()
export class DisputeService {
  constructor(
    private readonly jobs: JobsService,
    private readonly identity: IdentityService,
    @Inject(DISPUTE_REPO) private readonly disputes: DisputeRepository,
  ) {}

  /** Open a dispute: freeze funds, auto-assemble signals, resolve if clear-cut else escalate. */
  async open(actorId: string, jobId: string, counterEvidence = false): Promise<DisputeRecord> {
    const job = await this.jobs.getJob(actorId, jobId); // participant check + current status
    const signals: EvidenceSignals = {
      reachedGeofence: REACHED.has(job.status),
      validCodeEntered: job.status === 'COMPLETED',
      counterEvidence,
    };

    await this.jobs.openDispute(actorId, jobId); // -> DISPUTED (frozen)
    const decision = autoResolve(signals);

    const base: DisputeRecord = {
      id: randomUUID(), jobId, openedBy: actorId, status: 'UNDER_REVIEW',
      tier: decision.tier, createdAt: new Date().toISOString(),
    };

    if (decision.tier === 'auto') {
      await this.jobs.resolveDispute(jobId, decision.resolution);
      const resolved: DisputeRecord = {
        ...base, status: 'RESOLVED', resolution: decision.resolution, resolvedAt: new Date().toISOString(),
      };
      await this.disputes.create(resolved);
      return resolved;
    }

    await this.disputes.create(base); // awaits a human reviewer
    return base;
  }

  /** Admin resolves an escalated dispute with an audited outcome. */
  async resolve(disputeId: string, resolution: Resolution, riderShareMinor?: number): Promise<DisputeRecord> {
    const d = await this.disputes.find(disputeId);
    if (!d) throw new NotFoundException('Dispute not found');
    if (d.status === 'RESOLVED') throw new ConflictException('Dispute already resolved');

    await this.jobs.resolveDispute(d.jobId, resolution, riderShareMinor !== undefined ? { riderShareMinor } : {});
    await this.disputes.update(disputeId, {
      status: 'RESOLVED', resolution, resolvedAt: new Date().toISOString(),
    });
    return { ...d, status: 'RESOLVED', resolution };
  }

  /** On confirmed theft: permanently ban the identity + device (blocks re-registration). */
  async banForTheft(input: { nin?: string; bvn?: string; deviceId?: string; reason: string }): Promise<{ banned: true }> {
    await this.identity.banIdentity(input);
    return { banned: true };
  }
}
