import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TRAFFIC_PROVIDER, type TrafficProvider } from './traffic.port.js';
import { RELIABILITY_REPO, type LateReportRow, type ReliabilityRepo } from './ports.js';
import {
  activeStrikes, assessLateness, isSuspended, lateForfeitMinor, reliabilityScore, shouldSuspend,
  suspensionUntil, STRIKE_THRESHOLD,
} from './domain/reliability.js';

/** Inputs a caller (JobsService) gathers from a delivered job and hands to the reliability check. */
export interface LateReportInput {
  jobId: string;
  riderId: string;
  reporterId: string;         // the customer filing the report
  actualSec: number;          // pickup -> completion, from the status log
  staticEtaSec: number;       // our 15 km/h estimate (fallback / context)
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  deliveryFeeMinor: number;   // the trip's delivery fee (fare), for sizing any money forfeit
}

/**
 * Rider reliability: turns a customer's lateness report into a fair verdict (using a traffic-aware ETA),
 * accrues strikes, auto-suspends at the threshold, and — only when the admin money switch is on — records
 * the intended 10% forfeit. Strikes and suspension are always active; money is never moved here.
 */
@Injectable()
export class ReliabilityService {
  constructor(
    @Inject(RELIABILITY_REPO) private readonly repo: ReliabilityRepo,
    @Inject(TRAFFIC_PROVIDER) private readonly traffic: TrafficProvider,
    private readonly notify: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Judge a reported delivery. Auto-dismisses on-time trips, auto-strikes clearly-late ones, and sends
   *  everything the traffic check can't clearly clear to the admin queue (verdict UNCERTAIN → PENDING). */
  async reportLate(input: LateReportInput): Promise<{ reportId: string; verdict: string; status: string }> {
    const trafficAwareSec = await this.traffic.travelTimeSec(input.pickup, input.dropoff); // number | null
    const a = assessLateness({
      actualSec: input.actualSec, staticEtaSec: input.staticEtaSec,
      ...(trafficAwareSec != null ? { trafficAwareSec } : {}),
    });
    const verdict = a.verdict === 'late' ? 'LATE' : a.verdict === 'on_time' ? 'ON_TIME' : 'UNCERTAIN';
    const status = verdict === 'LATE' ? 'UPHELD' : verdict === 'ON_TIME' ? 'DISMISSED' : 'PENDING';

    const report = await this.repo.addReport({
      jobId: input.jobId, riderId: input.riderId, reporterId: input.reporterId,
      status, verdict, actualSec: Math.round(input.actualSec), staticEtaSec: Math.round(input.staticEtaSec),
      deliveryFeeMinor: input.deliveryFeeMinor,
      ...(trafficAwareSec != null ? { trafficAwareSec: Math.round(trafficAwareSec) } : {}),
    });

    if (verdict === 'LATE') {
      await this.applyStrike(input.riderId, input.jobId, 'Late delivery (auto, beyond traffic)');
      await this.maybeRecordForfeit(report);
    }
    return { reportId: report.id, verdict, status };
  }

  // ---------- suspension gate (used by JobsService.accept / go-online) ----------
  /** The rider's suspension end-time if currently suspended, else null. */
  async currentSuspensionUntil(riderId: string): Promise<number | null> {
    const until = await this.repo.getSuspendedUntil(riderId);
    return isSuspended(until, Date.now()) ? until : null;
  }
  /** Throw if the rider is currently suspended (blocks accepting jobs / going online). */
  async assertNotSuspended(riderId: string): Promise<void> {
    const until = await this.currentSuspensionUntil(riderId);
    if (until != null) {
      throw new ForbiddenException(`You're suspended until ${new Date(until).toLocaleString()} for repeated late deliveries.`);
    }
  }

  // ---------- admin ----------
  async listPending(limit = 200): Promise<LateReportRow[]> { return this.repo.listReportsByStatus('PENDING', limit); }

  async uphold(reportId: string, adminId: string): Promise<LateReportRow> {
    const r = await this.repo.findReport(reportId);
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== 'PENDING') return r; // idempotent — already decided
    const updated = await this.repo.updateReport(reportId, { status: 'UPHELD', reviewedBy: adminId, reviewedAt: Date.now() });
    await this.applyStrike(r.riderId, r.jobId, 'Late delivery (admin upheld)');
    await this.maybeRecordForfeit(r);
    return updated!;
  }

  async waive(reportId: string, adminId: string): Promise<LateReportRow> {
    const r = await this.repo.findReport(reportId);
    if (!r) throw new NotFoundException('Report not found');
    if (r.status !== 'PENDING') return r;
    return (await this.repo.updateReport(reportId, { status: 'WAIVED', reviewedBy: adminId, reviewedAt: Date.now() }))!;
  }

  /** Admin adds a strike directly (e.g. for a rider who chronically ranks low without a report). */
  async addManualStrike(riderId: string, jobId: string, reason?: string): Promise<void> {
    await this.applyStrike(riderId, jobId, reason ?? 'Admin strike');
  }

  async liftSuspension(riderId: string): Promise<void> {
    await this.repo.setSuspendedUntil(riderId, null);
  }

  async riderSummary(riderId: string): Promise<{
    riderId: string; activeStrikes: number; totalStrikes: number; suspendedUntil: number | null;
    score: number; reports: LateReportRow[];
  }> {
    const now = Date.now();
    const strikes = await this.repo.listStrikes(riderId);
    const active = activeStrikes(strikes.map((s) => ({ at: s.createdAt, jobId: s.jobId })), now);
    const reports = await this.repo.listReportsByRider(riderId, 200);
    const onTime = reports.filter((r) => r.verdict === 'ON_TIME').length;
    const judged = reports.filter((r) => r.verdict === 'ON_TIME' || r.verdict === 'LATE').length;
    const suspendedUntil = await this.repo.getSuspendedUntil(riderId);
    return {
      riderId, activeStrikes: active.length, totalStrikes: strikes.length,
      suspendedUntil: isSuspended(suspendedUntil, now) ? suspendedUntil : null,
      score: reliabilityScore(onTime, judged), reports: reports.slice(0, 50),
    };
  }

  // ---------- internals ----------
  private async applyStrike(riderId: string, jobId: string, reason: string): Promise<void> {
    await this.repo.addStrike(riderId, jobId, reason);
    const active = activeStrikes((await this.repo.listStrikes(riderId)).map((s) => ({ at: s.createdAt, jobId: s.jobId })), Date.now());
    if (shouldSuspend(active.length)) {
      const until = suspensionUntil(Date.now());
      await this.repo.setSuspendedUntil(riderId, until);
      await this.record(riderId, jobId, 'You are temporarily suspended',
        `Too many late deliveries this month. You're offline until ${new Date(until).toLocaleString()}.`);
    } else {
      await this.record(riderId, jobId, 'Late delivery recorded',
        `That delivery was late (${active.length}/${STRIKE_THRESHOLD}). ${STRIKE_THRESHOLD - active.length} more this month means a 1-day suspension.`);
    }
  }

  /** Record the intended forfeit on the report when the money switch is on. Money is NOT moved here
   *  (that is Phase 2); this just surfaces the amount to the admin so it's visible and auditable. */
  private async maybeRecordForfeit(report: LateReportRow): Promise<void> {
    if (!(await this.settings.lateMoneyPenaltyEnabled())) return;
    const forfeitMinor = lateForfeitMinor(report.deliveryFeeMinor);
    await this.repo.updateReport(report.id, { forfeitMinor });
  }

  private async record(riderId: string, jobId: string, title: string, body: string): Promise<void> {
    try { await this.notify.record(riderId, { title, body, jobId, urgent: true }); } catch { /* best-effort */ }
  }
}
