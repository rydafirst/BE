import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { stageDurations, timeInCurrentStage, totalElapsedMs } from './domain/stage-timing.js';
import { expectedDropSeconds, isDropLegStage, latenessTier, pickedUpAt, type LatenessTier } from './domain/lateness.js';
import { JOB_STATUS_LOG, type JobStatusLog } from './status-log.port.js';
import { JOB_REPO, type JobRepository } from './ports.js';
import type { JobStatus } from './domain/job-state-machine.js';

export interface JobTimings {
  stages: Array<{ status: JobStatus; ms: number; open: boolean }>;
  currentStageMs: number;
  totalMs: number;
  /** Drop-leg countdown, present only once picked up. All server-derived so the client can't be gamed. */
  drop?: { expectedSec: number; elapsedSec: number; remainingSec: number; lateness: LatenessTier };
}

/**
 * Read side of the status log: how long a delivery spent in each stage.
 *
 * Deliberately its own service rather than another method on JobsService, which is already 900+
 * lines and doing far too much. Timings need exactly two things — the log and a party check — so
 * giving them their own small class keeps that class understandable and starts pulling JobsService
 * apart rather than adding to it.
 */
@Injectable()
export class JobTimingsService {
  constructor(
    @Inject(JOB_STATUS_LOG) private readonly statusLog: JobStatusLog,
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
  ) {}

  /**
   * Timings for a job, visible only to its customer or its assigned rider.
   *
   * Same party rule the rest of the job endpoints use: this reveals the rhythm of someone's day
   * (when they were at a door, how long they waited), so it is not public just because it looks
   * like harmless metadata.
   */
  async forJob(actorId: string, jobId: string, nowMs = Date.now()): Promise<JobTimings> {
    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundException('Job not found');
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();

    const events = await this.statusLog.list(jobId);
    const pickup = pickedUpAt(events);
    let drop: JobTimings['drop'];
    if (pickup !== undefined && isDropLegStage(job.status)) {
      const expectedSec = expectedDropSeconds(job.pickup, job.dropoff);
      const elapsedSec = Math.max(0, (nowMs - pickup) / 1000);
      drop = {
        expectedSec,
        elapsedSec,
        remainingSec: Math.max(0, expectedSec - elapsedSec),
        lateness: latenessTier({ expectedSec, elapsedSec }),
      };
    }
    return {
      stages: stageDurations(events, nowMs),
      currentStageMs: timeInCurrentStage(events, nowMs),
      totalMs: totalElapsedMs(events, nowMs),
      ...(drop ? { drop } : {}),
    };
  }
}
