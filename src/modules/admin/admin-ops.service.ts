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

  reconciliation(): Promise<ReconciliationResult> {
    return this.escrow.reconciliationView();
  }
}
