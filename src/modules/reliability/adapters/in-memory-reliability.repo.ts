import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  LateReportPatch, LateReportRow, NewLateReport, ReliabilityRepo, ReportStatus, StrikeRow,
} from '../ports.js';

// DEV ONLY. Swapped for the Postgres-backed repo when DB_DRIVER=postgres.
@Injectable()
export class InMemoryReliabilityRepo implements ReliabilityRepo {
  private strikes: StrikeRow[] = [];
  private reports = new Map<string, LateReportRow>();
  private suspended = new Map<string, number>(); // riderId -> suspendedUntil ms

  async addStrike(riderId: string, jobId: string, reason?: string): Promise<StrikeRow> {
    const s: StrikeRow = { id: randomUUID(), riderId, jobId, createdAt: Date.now(), ...(reason ? { reason } : {}) };
    this.strikes.push(s);
    return s;
  }
  async listStrikes(riderId: string): Promise<StrikeRow[]> {
    return this.strikes.filter((s) => s.riderId === riderId).sort((a, b) => b.createdAt - a.createdAt);
  }
  async addReport(n: NewLateReport): Promise<LateReportRow> {
    const r: LateReportRow = {
      id: randomUUID(), createdAt: Date.now(),
      jobId: n.jobId, riderId: n.riderId, reporterId: n.reporterId, status: n.status, verdict: n.verdict,
      actualSec: n.actualSec, staticEtaSec: n.staticEtaSec, deliveryFeeMinor: n.deliveryFeeMinor,
      ...(n.trafficAwareSec != null ? { trafficAwareSec: n.trafficAwareSec } : {}),
      ...(n.forfeitMinor != null ? { forfeitMinor: n.forfeitMinor } : {}),
    };
    this.reports.set(r.id, r);
    return r;
  }
  async findReport(id: string): Promise<LateReportRow | null> { return this.reports.get(id) ?? null; }
  async listReportsByStatus(status: ReportStatus, limit: number): Promise<LateReportRow[]> {
    return [...this.reports.values()].filter((r) => r.status === status).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async listReportsByRider(riderId: string, limit: number): Promise<LateReportRow[]> {
    return [...this.reports.values()].filter((r) => r.riderId === riderId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async updateReport(id: string, patch: LateReportPatch): Promise<LateReportRow | null> {
    const r = this.reports.get(id);
    if (!r) return null;
    const next: LateReportRow = { ...r };
    if (patch.status != null) next.status = patch.status;
    if (patch.reviewedBy != null) next.reviewedBy = patch.reviewedBy;
    if (patch.reviewedAt != null) next.reviewedAt = patch.reviewedAt;
    if (patch.forfeitMinor != null) next.forfeitMinor = patch.forfeitMinor;
    this.reports.set(id, next);
    return next;
  }
  async getSuspendedUntil(riderId: string): Promise<number | null> { return this.suspended.get(riderId) ?? null; }
  async setSuspendedUntil(riderId: string, untilMs: number | null): Promise<void> {
    if (untilMs == null) this.suspended.delete(riderId);
    else this.suspended.set(riderId, untilMs);
  }
}
