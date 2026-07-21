import type { JobStatus } from './domain/job-state-machine.js';
import type { StatusEvent } from './domain/stage-timing.js';

/**
 * Append-only record of the statuses a job passed through.
 *
 * Separate from JobRepository on purpose (Interface Segregation): the job repo owns the job's
 * CURRENT state, this owns its HISTORY. They have different write patterns — one updates in place,
 * the other only ever appends — and nothing that reads timings needs the ability to mutate a job.
 *
 * There is no update or delete. History that can be rewritten is not evidence, and these timings are
 * what ops will read when a rider and a sender disagree about what happened.
 */
export interface JobStatusLog {
  append(jobId: string, status: JobStatus, atMs: number): Promise<void>;
  list(jobId: string): Promise<StatusEvent[]>;
  /**
   * Jobs currently sitting in one of `statuses` whose latest event is older than `olderThanMs`.
   * Used by the inactivity scan, which must not pull every job in the system to find the stalled few.
   */
  stalledSince(statuses: readonly JobStatus[], olderThanMs: number, limit: number): Promise<Array<{ jobId: string; status: JobStatus; at: number }>>;
}

export const JOB_STATUS_LOG = Symbol('JOB_STATUS_LOG');
