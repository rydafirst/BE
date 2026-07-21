import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

export const PAYOUT_DISPATCHER = Symbol('PAYOUT_DISPATCHER');

/**
 * Decides WHEN the best-effort external disbursement runs relative to the caller's request.
 *
 * Why this exists: the ledger release is our source of truth and is written durably and
 * synchronously. The external bank transfer is neither — it is best-effort, already flagged
 * `payoutPending` on failure, and already re-drivable from Admin → Finance. Leaving it on the HTTP
 * request path meant a slow or failing PSP made the RIDER'S DELIVERY CONFIRMATION slow, which is how
 * a 12-second Flutterwave timeout turned into "invalid code" on the rider's phone.
 *
 * Keeping the choice behind a port means EscrowService never learns whether it is running inline or
 * deferred (DIP), and a real queue can be dropped in later without touching the money engine (OCP).
 */
export interface PayoutDispatcher {
  /**
   * @param task        the external money movement. MUST NOT throw — it reports failure in its result.
   * @param onSettled   persists a known outcome (idempotency record + job payout flag). MAY BE CALLED
   *                    MORE THAN ONCE — first with `whenDeferred`, later with the real outcome — so it
   *                    must be a last-write-wins upsert, never an append.
   * @param whenDeferred the outcome to report to the caller if the task has not run yet.
   * @returns the real outcome when run inline, or `whenDeferred` when scheduled for later.
   */
  execute<T>(task: () => Promise<T>, onSettled: (outcome: T) => Promise<void>, whenDeferred: T): Promise<T>;
}

/**
 * Runs the disbursement inside the caller's request — the original behaviour, kept as the default so
 * that any construction of EscrowService without explicit wiring (unit tests, scripts) behaves
 * exactly as it did before this port existed.
 */
@Injectable()
export class InlinePayoutDispatcher implements PayoutDispatcher {
  async execute<T>(task: () => Promise<T>, onSettled: (outcome: T) => Promise<void>, _whenDeferred: T): Promise<T> {
    const outcome = await task();
    await onSettled(outcome);
    return outcome;
  }
}

/**
 * Runs the disbursement after the caller's request has been answered.
 *
 * Safety properties:
 *  - The deferred outcome is persisted BEFORE scheduling, so a concurrent settle replay reads
 *    "queued" instead of hitting the in-progress claim, and the job shows up in the retry queue
 *    immediately rather than only after the attempt fails.
 *  - Nothing here can crash the process: the task is contracted not to throw, and `onSettled` is
 *    wrapped, because an unhandled rejection in a floating promise terminates Node by default.
 *  - In-flight work is awaited on shutdown, so a redeploy does not silently drop a payout attempt.
 *    Anything still lost is recoverable — the job stays flagged `payoutPending` for admin retry.
 */
@Injectable()
export class DeferredPayoutDispatcher implements PayoutDispatcher, OnApplicationShutdown {
  private readonly log = new Logger(DeferredPayoutDispatcher.name);
  private readonly inFlight = new Set<Promise<void>>();

  async execute<T>(task: () => Promise<T>, onSettled: (outcome: T) => Promise<void>, whenDeferred: T): Promise<T> {
    // Record "queued" first: if the process dies before the attempt runs, the job is already visible
    // as pending rather than looking settled.
    await onSettled(whenDeferred);

    // setImmediate, not a bare async call: a task that happens to resolve without real I/O would
    // otherwise still run during this function's microtask drain. Handing it to the next event-loop
    // turn makes "the caller never waits" a property of the adapter rather than of the task.
    const run = new Promise<void>((resolve) => {
      setImmediate(async () => {
        try {
          await onSettled(await task());
        } catch (e) {
          // Recoverable by design — the persisted state is still "pending", so admin retry drives it.
          this.log.error(`Deferred payout failed to settle: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          resolve();
        }
      });
    });
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));

    return whenDeferred;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.inFlight.size === 0) return;
    this.log.log(`Waiting for ${this.inFlight.size} in-flight payout(s) before shutdown`);
    await Promise.allSettled([...this.inFlight]);
  }
}
