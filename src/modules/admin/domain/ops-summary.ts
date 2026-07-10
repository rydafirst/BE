import { isTerminal, type JobStatus } from '../../jobs/domain/job-state-machine.js';

export interface JobLite { id: string; status: JobStatus }

export interface OpsSummary {
  activeTotal: number;
  byStatus: Partial<Record<JobStatus, number>>;
}

/** Live ops view: counts of non-terminal jobs by status. */
export function opsSummary(jobs: readonly JobLite[]): OpsSummary {
  const byStatus: Partial<Record<JobStatus, number>> = {};
  let activeTotal = 0;
  for (const j of jobs) {
    if (isTerminal(j.status)) continue;
    activeTotal += 1;
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  }
  return { activeTotal, byStatus };
}
