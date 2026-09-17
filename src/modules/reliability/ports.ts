export type ReportStatus = 'PENDING' | 'UPHELD' | 'WAIVED' | 'DISMISSED';
export type ReportVerdict = 'ON_TIME' | 'LATE' | 'UNCERTAIN';

export interface StrikeRow { id: string; riderId: string; jobId: string; reason?: string; createdAt: number }

export interface LateReportRow {
  id: string;
  jobId: string;
  riderId: string;
  reporterId: string;
  status: ReportStatus;
  verdict: ReportVerdict;
  actualSec: number;
  staticEtaSec: number;
  trafficAwareSec?: number;
  deliveryFeeMinor: number;   // the trip's delivery fee, stored so an admin uphold can size the forfeit later
  forfeitMinor?: number;      // recorded intended forfeit (money only moves in Phase 2, when the switch is on)
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
}
export interface NewLateReport {
  jobId: string;
  riderId: string;
  reporterId: string;
  status: ReportStatus;
  verdict: ReportVerdict;
  actualSec: number;
  staticEtaSec: number;
  trafficAwareSec?: number;
  deliveryFeeMinor: number;
  forfeitMinor?: number;
}
export type LateReportPatch = Partial<Pick<LateReportRow, 'status' | 'reviewedBy' | 'reviewedAt' | 'forfeitMinor'>>;

/** Persistence for strikes, late reports, and per-rider suspension end-times. */
export interface ReliabilityRepo {
  addStrike(riderId: string, jobId: string, reason?: string): Promise<StrikeRow>;
  listStrikes(riderId: string): Promise<StrikeRow[]>;
  addReport(r: NewLateReport): Promise<LateReportRow>;
  findReport(id: string): Promise<LateReportRow | null>;
  listReportsByStatus(status: ReportStatus, limit: number): Promise<LateReportRow[]>;
  listReportsByRider(riderId: string, limit: number): Promise<LateReportRow[]>;
  updateReport(id: string, patch: LateReportPatch): Promise<LateReportRow | null>;
  getSuspendedUntil(riderId: string): Promise<number | null>;
  setSuspendedUntil(riderId: string, untilMs: number | null): Promise<void>;
}
export const RELIABILITY_REPO = Symbol('RELIABILITY_REPO');
