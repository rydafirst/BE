import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { JobStatus } from '../domain/job-state-machine.js';
import type { StatusEvent } from '../domain/stage-timing.js';
import type { JobStatusLog } from '../status-log.port.js';

/** Dev/test store. Same append-only contract as the Postgres one. */
@Injectable()
export class InMemoryJobStatusLog implements JobStatusLog {
  private m = new Map<string, StatusEvent[]>();

  async append(jobId: string, status: JobStatus, atMs: number): Promise<void> {
    const list = this.m.get(jobId) ?? [];
    list.push({ status, at: atMs });
    this.m.set(jobId, list);
  }

  async list(jobId: string): Promise<StatusEvent[]> {
    return [...(this.m.get(jobId) ?? [])].sort((a, b) => a.at - b.at);
  }

  async stalledSince(statuses: readonly JobStatus[], olderThanMs: number, limit: number) {
    const out: Array<{ jobId: string; status: JobStatus; at: number }> = [];
    for (const [jobId, events] of this.m) {
      const latest = [...events].sort((a, b) => b.at - a.at)[0];
      if (!latest || !statuses.includes(latest.status) || latest.at > olderThanMs) continue;
      out.push({ jobId, status: latest.status, at: latest.at });
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** Shape of a JobStatusEvent row. Declared locally so this file typechecks whether or not the
 *  Prisma client has been regenerated (the same approach prisma-job.repo.ts already takes). */
interface EventRow { jobId: string; status: string; at: Date }
interface EventGroup { jobId: string; _max: { at: Date | null } }

/** Postgres-backed history. */
@Injectable()
export class PrismaJobStatusLog implements JobStatusLog {
  constructor(private readonly db: PrismaService) {}

  async append(jobId: string, status: JobStatus, atMs: number): Promise<void> {
    await this.db.jobStatusEvent.create({ data: { jobId, status, at: new Date(atMs) } });
  }

  async list(jobId: string): Promise<StatusEvent[]> {
    const rows = await this.db.jobStatusEvent.findMany({ where: { jobId }, orderBy: { at: 'asc' } });
    return (rows as EventRow[]).map((r) => ({ status: r.status as JobStatus, at: r.at.getTime() }));
  }

  /**
   * Latest event per job, filtered to the stages worth watching and old enough to matter.
   *
   * Done as one grouped query rather than by loading candidate jobs and walking their logs: the scan
   * runs on a timer forever, so it must stay cheap as the event table grows.
   */
  async stalledSince(statuses: readonly JobStatus[], olderThanMs: number, limit: number) {
    const groups = await this.db.jobStatusEvent.groupBy({
      by: ['jobId'],
      _max: { at: true },
      having: { at: { _max: { lte: new Date(olderThanMs) } } },
      take: limit,
    });
    if (groups.length === 0) return [];

    // Re-read those latest rows to learn WHICH status each job is sitting in; groupBy cannot
    // return a non-aggregated column alongside the max.
    const rows = await this.db.jobStatusEvent.findMany({
      where: { OR: (groups as EventGroup[]).map((g) => ({ jobId: g.jobId, at: g._max.at ?? new Date(0) })) },
    });
    return (rows as EventRow[])
      .filter((r) => statuses.includes(r.status as JobStatus))
      .map((r) => ({ jobId: r.jobId, status: r.status as JobStatus, at: r.at.getTime() }));
  }
}
