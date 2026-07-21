import { type JobStatus } from './job-state-machine.js';

/** One recorded transition into a status. Append-only: a job's history is never rewritten. */
export interface StatusEvent {
  status: JobStatus;
  at: number; // epoch ms
}

/** How long the job sat in `status` before moving to `next` (or before `now`, if still there). */
export interface StageDuration {
  status: JobStatus;
  ms: number;
  /** True when this is the stage the job is currently in, so the duration is still growing. */
  open: boolean;
}

/**
 * Per-stage durations from an append-only event log.
 *
 * Deliberately derived rather than stored: a duration computed from two timestamps can never
 * disagree with the timestamps themselves. Storing durations as their own field invites exactly that
 * drift the first time an event is backfilled or corrected.
 *
 * Tolerates a log that is out of order (events may be written concurrently) and ignores duplicate
 * consecutive statuses, which a retried write can produce.
 */
export function stageDurations(events: readonly StatusEvent[], nowMs: number): StageDuration[] {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const out: StageDuration[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) continue;
    // A retried write can log the same status twice; treat it as one stage.
    if (out.length > 0 && out[out.length - 1]?.status === cur.status) continue;

    const next = sorted.slice(i + 1).find((e) => e.status !== cur.status);
    const end = next ? next.at : nowMs;
    out.push({
      status: cur.status,
      // Clamp: a clock skew between writers must never surface as a negative duration.
      ms: Math.max(0, end - cur.at),
      open: !next,
    });
  }
  return out;
}

/** Total elapsed time from the first recorded event to the last (or to now while still open). */
export function totalElapsedMs(events: readonly StatusEvent[], nowMs: number): number {
  if (events.length === 0) return 0;
  const times = events.map((e) => e.at);
  return Math.max(0, nowMs - Math.min(...times));
}

/** How long the job has been sitting in its current stage. 0 when there is no history. */
export function timeInCurrentStage(events: readonly StatusEvent[], nowMs: number): number {
  const durations = stageDurations(events, nowMs);
  return durations.find((d) => d.open)?.ms ?? 0;
}
