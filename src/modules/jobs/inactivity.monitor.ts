import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { isStalled, reminderKey, stallReminder, watchedStages } from './domain/inactivity.js';
import { JOB_STATUS_LOG, type JobStatusLog } from './status-log.port.js';
import { JOB_REPO, type JobRepository } from './ports.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NOTIFICATION_OUTBOX, type NotificationOutbox } from '../notifications/ports.js';

const SCAN_EVERY_MS = 2 * 60_000;
const SCAN_LIMIT = 200; // bound the work per tick so a backlog can never stall the process
/** Shortest threshold in the rules; nothing younger than this can possibly be stalled. */
const MIN_THRESHOLD_MS = 5 * 60_000;

/**
 * Nudges riders who appear to have forgotten to update a delivery's status.
 *
 * Implemented with a plain interval and Nest lifecycle hooks rather than @nestjs/schedule: the need
 * is one timer, and that is not worth a new dependency in a service that handles money.
 *
 * Safety:
 *  - Every send goes through the notification outbox under a per-(job, stage) key, so a rider is
 *    nudged at most ONCE per stage no matter how often the scan runs or how many instances run it.
 *  - The scan is bounded and never throws; a failed tick is skipped, not retried into a loop.
 *  - Decisions live in the pure `inactivity` domain — this class only fetches, asks, and sends.
 */
@Injectable()
export class InactivityMonitor implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(InactivityMonitor.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(JOB_STATUS_LOG) private readonly statusLog: JobStatusLog,
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
    @Inject(NOTIFICATION_OUTBOX) private readonly outbox: NotificationOutbox,
    private readonly notify: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.scan(), SCAN_EVERY_MS);
    // Do not hold the event loop open purely for this timer.
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so it can be driven directly from a test or an ops trigger. */
  async scan(nowMs = Date.now()): Promise<number> {
    if (this.running) return 0; // a slow tick must not overlap the next one
    this.running = true;
    let sent = 0;
    try {
      const candidates = await this.statusLog.stalledSince(
        watchedStages(), nowMs - MIN_THRESHOLD_MS, SCAN_LIMIT,
      );
      for (const c of candidates) {
        if (!isStalled(c.status, nowMs - c.at)) continue; // per-stage threshold, not the global floor

        const key = reminderKey(c.jobId, c.status);
        if (await this.outbox.seen(key)) continue;

        const job = await this.jobs.find(c.jobId);
        // The log is append-only, so it can lag the job: only nudge if the job is STILL in this
        // stage and still has the rider it had. Otherwise the rider already moved on.
        if (!job || !job.riderId || job.status !== c.status) continue;

        const message = stallReminder(c.status);
        if (!message) continue;

        await this.notify.record(job.riderId, { ...message, jobId: job.id, urgent: true });
        await this.outbox.mark(key);
        sent++;
      }
    } catch (e) {
      this.log.warn(`Inactivity scan skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return sent;
  }
}
