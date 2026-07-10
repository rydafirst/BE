import { Injectable } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { EscrowService } from '../payments/escrow.service.js';

export interface WalletSummary {
  releasedMinor: number;   // total paid out to the rider (RELEASED / adjudicated)
  currency: 'NGN';
  jobsCount: number;
  activeCount: number;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly jobs: JobsService,
    private readonly escrow: EscrowService,
  ) {}

  /** A rider's earnings, derived from the append-only ledger — never a stored balance. */
  async summary(riderId: string): Promise<WalletSummary> {
    const jobs = await this.jobs.jobsForRider(riderId);
    const releasedMinor = await this.escrow.releasedEarningsForJobs(jobs.map((j) => j.id));
    const activeCount = jobs.filter((j) => !['RELEASED', 'CANCELLED', 'DISPUTE_RESOLVED'].includes(j.status)).length;
    return { releasedMinor, currency: 'NGN', jobsCount: jobs.length, activeCount };
  }
}
