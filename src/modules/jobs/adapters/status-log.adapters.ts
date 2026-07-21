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
   * Raw SQL rather than Prisma's `groupBy`, for two reasons:
   *  - `DISTINCT ON` gets the latest row per job with its status in ONE query. `groupBy` can only
   *    return aggregates, so it needed a second query to discover which status each job was in.
   *  - `groupBy`'s generated types are strict in ways that differ from the ungenerated client
   *    (it demands `orderBy` alongside `take`), which is exactly what broke the build here.
   *
   * All three values are bound parameters, so nothing is interpolated into the statement.
   * The (jobId, at) index backs the DISTINCT ON ordering.
   */
  async stalledSince(statuses: readonly JobStatus[], olderThanMs: number, limit: number) {
    if (statuses.length === 0) return [];
    // Annotated on the binding, not just the generic: the generic is erased when the Prisma client
    // has not been regenerated, and an implicit `any` here is how the last type error reached prod.
    const rows: EventRow[] = await this.db.$queryRaw<EventRow[]>`
      SELECT latest."jobId", latest."status", latest."at"
      FROM (
        SELECT DISTINCT ON (e."jobId") e."jobId", e."status"::text AS "status", e."at"
        FROM "JobStatusEvent" e
        ORDER BY e."jobId", e."at" DESC
      ) latest
      WHERE latest."at" <= ${new Date(olderThanMs)}
        AND latest."status" = ANY(${statuses as string[]})
      LIMIT ${limit}
    `;
    // Re-filter in JS as well: the scan drives unsolicited notifications, so a status slipping
    // through on an unexpected driver quirk must not become a nudge.
    return rows
      .filter((r) => statuses.includes(r.status as JobStatus))
      .map((r) => ({ jobId: r.jobId, status: r.status as JobStatus, at: r.at.getTime() }));
  }
}
