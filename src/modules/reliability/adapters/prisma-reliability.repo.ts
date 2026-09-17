import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type {
  LateReportPatch, LateReportRow, NewLateReport, ReliabilityRepo, ReportStatus, ReportVerdict, StrikeRow,
} from '../ports.js';

// The generated Prisma client can lag brand-new models (offline CI), so reach the delegates through a
// loose shape; runtime uses the real generated delegates. Mirrors the vendors repo.
interface AnyDelegate {
  create(a: unknown): Promise<unknown>;
  findUnique(a: unknown): Promise<unknown>;
  findMany(a: unknown): Promise<unknown>;
  update(a: unknown): Promise<unknown>;
  upsert(a: unknown): Promise<unknown>;
}
type PrismaWrite = never;
const strikeDelegate = (db: PrismaService): AnyDelegate => (db as unknown as { riderStrike: AnyDelegate }).riderStrike;
const reportDelegate = (db: PrismaService): AnyDelegate => (db as unknown as { lateReport: AnyDelegate }).lateReport;
const relDelegate = (db: PrismaService): AnyDelegate => (db as unknown as { riderReliability: AnyDelegate }).riderReliability;

interface SRow { id: string; riderId: string; jobId: string; reason: string | null; createdAt: Date }
function toStrike(r: SRow): StrikeRow {
  return { id: r.id, riderId: r.riderId, jobId: r.jobId, createdAt: r.createdAt.getTime(), ...(r.reason ? { reason: r.reason } : {}) };
}

interface RRow {
  id: string; jobId: string; riderId: string; reporterId: string; status: string; verdict: string;
  actualSec: number; staticEtaSec: number; trafficAwareSec: number | null; deliveryFeeMinor: number;
  forfeitMinor: number | null; reviewedBy: string | null; reviewedAt: Date | null; createdAt: Date;
}
function toReport(r: RRow): LateReportRow {
  return {
    id: r.id, jobId: r.jobId, riderId: r.riderId, reporterId: r.reporterId,
    status: r.status as ReportStatus, verdict: r.verdict as ReportVerdict,
    actualSec: r.actualSec, staticEtaSec: r.staticEtaSec, deliveryFeeMinor: r.deliveryFeeMinor,
    createdAt: r.createdAt.getTime(),
    ...(r.trafficAwareSec != null ? { trafficAwareSec: r.trafficAwareSec } : {}),
    ...(r.forfeitMinor != null ? { forfeitMinor: r.forfeitMinor } : {}),
    ...(r.reviewedBy ? { reviewedBy: r.reviewedBy } : {}),
    ...(r.reviewedAt ? { reviewedAt: r.reviewedAt.getTime() } : {}),
  };
}

@Injectable()
export class PrismaReliabilityRepo implements ReliabilityRepo {
  constructor(private readonly db: PrismaService) {}

  async addStrike(riderId: string, jobId: string, reason?: string): Promise<StrikeRow> {
    const row = await strikeDelegate(this.db).create({ data: { riderId, jobId, reason: reason ?? null } as PrismaWrite });
    return toStrike(row as unknown as SRow);
  }
  async listStrikes(riderId: string): Promise<StrikeRow[]> {
    const rows = await strikeDelegate(this.db).findMany({ where: { riderId } as PrismaWrite, orderBy: { createdAt: 'desc' } });
    return (rows as unknown as SRow[]).map(toStrike);
  }
  async addReport(n: NewLateReport): Promise<LateReportRow> {
    const row = await reportDelegate(this.db).create({ data: {
      jobId: n.jobId, riderId: n.riderId, reporterId: n.reporterId, status: n.status, verdict: n.verdict,
      actualSec: n.actualSec, staticEtaSec: n.staticEtaSec, deliveryFeeMinor: n.deliveryFeeMinor,
      trafficAwareSec: n.trafficAwareSec ?? null, forfeitMinor: n.forfeitMinor ?? null,
    } as PrismaWrite });
    return toReport(row as unknown as RRow);
  }
  async findReport(id: string): Promise<LateReportRow | null> {
    const row = await reportDelegate(this.db).findUnique({ where: { id } });
    return row ? toReport(row as unknown as RRow) : null;
  }
  async listReportsByStatus(status: ReportStatus, limit: number): Promise<LateReportRow[]> {
    const rows = await reportDelegate(this.db).findMany({ where: { status } as PrismaWrite, orderBy: { createdAt: 'desc' }, take: limit });
    return (rows as unknown as RRow[]).map(toReport);
  }
  async listReportsByRider(riderId: string, limit: number): Promise<LateReportRow[]> {
    const rows = await reportDelegate(this.db).findMany({ where: { riderId } as PrismaWrite, orderBy: { createdAt: 'desc' }, take: limit });
    return (rows as unknown as RRow[]).map(toReport);
  }
  async updateReport(id: string, patch: LateReportPatch): Promise<LateReportRow | null> {
    const data: Record<string, unknown> = {};
    if (patch.status != null) data.status = patch.status;
    if (patch.reviewedBy != null) data.reviewedBy = patch.reviewedBy;
    if (patch.reviewedAt != null) data.reviewedAt = new Date(patch.reviewedAt);
    if (patch.forfeitMinor != null) data.forfeitMinor = patch.forfeitMinor;
    const row = await reportDelegate(this.db).update({ where: { id }, data: data as PrismaWrite });
    return toReport(row as unknown as RRow);
  }
  async getSuspendedUntil(riderId: string): Promise<number | null> {
    const row = await relDelegate(this.db).findUnique({ where: { riderId } as PrismaWrite }) as { suspendedUntil: Date | null } | null;
    return row?.suspendedUntil ? row.suspendedUntil.getTime() : null;
  }
  async setSuspendedUntil(riderId: string, untilMs: number | null): Promise<void> {
    const until = untilMs != null ? new Date(untilMs) : null;
    await relDelegate(this.db).upsert({
      where: { riderId } as PrismaWrite,
      create: { riderId, suspendedUntil: until } as PrismaWrite,
      update: { suspendedUntil: until } as PrismaWrite,
    });
  }
}
