import { Injectable } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { EscrowService } from '../payments/escrow.service.js';
import { opsSummary, type OpsSummary } from './domain/ops-summary.js';
import type { ReconciliationResult } from '../payments/domain/reconciliation.js';

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly jobs: JobsService,
    private readonly escrow: EscrowService,
  ) {}

  async activeJobs(): Promise<{ summary: OpsSummary; jobs: { id: string; status: string; type: string }[] }> {
    const jobs = await this.jobs.listActiveJobs();
    return {
      summary: opsSummary(jobs.map((j) => ({ id: j.id, status: j.status }))),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, type: j.type })),
    };
  }

  /** Full recent-delivery feed for the admin monitor (newest first), with the fields a card needs. */
  async deliveries(): Promise<Array<{ id: string; status: string; type: string; amountMinor: number; pickupArea?: string; dropoffArea?: string; createdAt: string }>> {
    const jobs = await this.jobs.listRecentJobs(100);
    return jobs.map((j) => ({
      id: j.id, status: j.status, type: j.type, amountMinor: j.amountMinor, createdAt: j.createdAt,
      ...(j.pickupArea ? { pickupArea: j.pickupArea } : {}),
      ...(j.dropoffArea ? { dropoffArea: j.dropoffArea } : {}),
    }));
  }

  async finance(): Promise<{ totals: { held: number; released: number; refunded: number }; reconciliation: ReconciliationResult }> {
    const [totals, reconciliation] = await Promise.all([this.escrow.escrowTotals(), this.escrow.reconciliationView()]);
    return { totals, reconciliation };
  }
}
