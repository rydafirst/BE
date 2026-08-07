import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  customerLateKey, customerLateMessage, expectedDropSeconds, isDropLegStage, latenessTier,
  pickedUpAt, riderLateKey, riderLateMessage, DROP_LEG_STAGES,
} from './domain/lateness.js';
import { JOB_STATUS_LOG, type JobStatusLog } from './status-log.port.js';
import { JOB_REPO, type JobRepository } from './ports.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NOTIFICATION_OUTBOX, type NotificationOutbox } from '../notifications/ports.js';

const SCAN_EVERY_MS = 2 * 60_000;
const SCAN_LIMIT = 200;

/**
 * Flags deliveries whose drop leg is taking far longer than the ETA and escalates:
 *   rider  (1.5x ETA) -> nudge the rider;
 *   all    (2x ETA)   -> also tell the customer (and ops sees it in the admin console — see
 *                        AdminOpsService, which is pull-based and reads the same lateness domain).
 *
 * Mirrors InactivityMonitor exactly — a plain unref'd interval, a per-tick guard, a bounded scan
 * that never throws — and shares its safety properties:
 *  - Every alert goes through the notification outbox under a per-(job, tier) key, so each party is
 *    told at most ONCE per delivery no matter how often the scan runs or how many instances run it.
 *  - Decisions live in the pure `lateness` domain; this class only fetches, asks, and sends.
 *  - It touches ONLY notifications — never the ledger — so a false "late" reading cannot move money.
 */
@Injectable()
export class LatenessMonitor implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(LatenessMonitor.name);
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
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so a test or an ops trigger can drive it directly. Returns alerts sent. */
  async scan(nowMs = Date.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      // Every job currently sitting in a drop-leg stage (olderThan = now => no age floor).
      const candidates = await this.statusLog.stalledSince(DROP_LEG_STAGES, nowMs, SCAN_LIMIT);
      for (const c of candidates) {
        const job = await this.jobs.find(c.jobId);
        // The append-only log can lag the job: only act if it is STILL in a drop-leg stage and still
        // has a rider. Otherwise it already completed / moved on.
        if (!job || !job.riderId || !isDropLegStage(job.status)) continue;

        const events = await this.statusLog.list(c.jobId);
        const pickup = pickedUpAt(events);
        if (pickup === undefined) continue; // not actually picked up yet

        const expectedSec = expectedDropSeconds(job.pickup, job.dropoff);
        const elapsedSec = (nowMs - pickup) / 1000;
        const tier = latenessTier({ expectedSec, elapsedSec });
        if (tier === 'none') continue;

        // Rider tier fires for both 'rider' and 'all'.
        const rKey = riderLateKey(job.id);
        if (!(await this.outbox.seen(rKey))) {
          await this.notify.record(job.riderId, { ...riderLateMessage(), jobId: job.id, urgent: true });
          await this.outbox.mark(rKey);
          sent++;
        }
        // Customer (+ ops visibility) only at the higher threshold.
        if (tier === 'all') {
          const cKey = customerLateKey(job.id);
          if (!(await this.outbox.seen(cKey))) {
            await this.notify.record(job.customerId, { ...customerLateMessage(), jobId: job.id, urgent: true });
            await this.outbox.mark(cKey);
            sent++;
          }
        }
      }
    } catch (e) {
      this.log.warn(`Lateness scan skipped: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return sent;
  }
}
