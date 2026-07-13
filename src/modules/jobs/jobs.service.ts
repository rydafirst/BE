import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { Money } from '../payments/domain/money.js';
import { EscrowService } from '../payments/escrow.service.js';
import type { VerifiedTxn } from '../payments/payment-provider.interface.js';
import { assertTransition, type JobStatus } from './domain/job-state-machine.js';
import { computeFare, type FareBreakdown } from './domain/fare.js';
import { haversineMeters, type GeoPoint } from './domain/geo.js';
import { isWithinGeofence } from '../confirmations/domain/geofence.js';
import { signQuote, verifyQuote } from './domain/quote-token.js';
import { cancellationPolicy } from './domain/cancellation.js';
import { canReleaseJob, MAX_RIDER_RELEASES_PER_DAY, RELEASE_WINDOW_SECONDS } from './domain/rider-release.js';
import { failedAttemptFee } from './domain/failed-attempt-fee.js';
import { isPaymentExpired } from './domain/payment-window.js';
import { coarseArea } from './domain/area.js';
import { approximatePoint } from './domain/approx.js';
import { resolutionToSettlement, type Resolution } from '../disputes/domain/dispute.js';
import { JOB_REPO, type Job, type JobRepository } from './ports.js';
import { RATE_LIMITER, type RateLimiter } from '../auth/ports.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { RatingsService } from '../ratings/ratings.service.js';
import { isValidStars } from '../ratings/domain/rating.js';
import type { Rating } from '../ratings/ports.js';
import { ridersToAnnounce } from './domain/broadcast.js';
import { RIDER_PAYOUT, type RiderPayoutSource } from './rider-payout.port.js';
import type { QuoteRequestDto, CreateJobDto } from './dto/jobs.dto.js';

const QUOTE_TTL_MS = 900_000; // 15 minutes — long enough to read options + pay without the quote going stale
const PROGRESS_STEPS: readonly JobStatus[] = ['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'];

export type CreatedJob = Job & { paymentLink: string };

/** PII-free projection shown to riders in the discovery feed. Only a COARSE area is exposed
 *  pre-accept (no exact coordinates, no recipient/customer/refund data). */
export type AvailableJob = Pick<Job, 'id' | 'type' | 'amountMinor' | 'currency' | 'createdAt'>
  & { pickupArea: string; dropoffArea: string; pickupApprox: { lat: number; lng: number } };

@Injectable()
export class JobsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
    @Inject(RIDER_PAYOUT) private readonly payout: RiderPayoutSource,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly escrow: EscrowService,
    private readonly notify: NotificationsService,
    private readonly presence: PresenceService,
    private readonly documents: DocumentsService,
    private readonly ratings: RatingsService,
  ) {}

  /**
   * Ring the online rider pool that a job is available to accept (Uber-style job alert).
   * Push-only and fully best-effort — a broadcast failure can never affect the order or its money.
   */
  private async announceToOnlineRiders(jobId: string, excludeRiderId?: string): Promise<void> {
    try {
      const online = await this.presence.listOnline();
      const targets = ridersToAnnounce(online, excludeRiderId ? { exclude: excludeRiderId } : {});
      if (targets.length === 0) return;
      await this.notify.announceToRiders(targets, {
        title: 'New delivery available',
        body: 'A new job is available near you. Open Rydafirst to accept it.',
        jobId,
      });
    } catch { /* best-effort */ }
  }

  quote(dto: QuoteRequestDto): { quoteToken: string; amountMinor: number; currency: 'NGN'; breakdown: FareBreakdown } {
    const distance = haversineMeters(dto.pickup, dto.dropoff);
    const breakdown = computeFare(dto.type, distance);
    const quoteToken = signQuote(
      { type: dto.type, amountMinor: breakdown.totalMinor, currency: 'NGN', pickup: dto.pickup, dropoff: dto.dropoff, exp: Date.now() + QUOTE_TTL_MS },
      this.env.JOBS_QUOTE_SECRET,
    );
    return { quoteToken, amountMinor: breakdown.totalMinor, currency: 'NGN', breakdown };
  }

  /** Create a job and start collection; returns the job + hosted-checkout link. */
  async createJob(customerId: string, dto: CreateJobDto): Promise<CreatedJob> {
    const v = verifyQuote(dto.quoteToken, this.env.JOBS_QUOTE_SECRET, Date.now());
    if (!v.ok) throw new BadRequestException(`Invalid quote (${v.reason})`);

    // One unpaid order at a time: block a new order while the customer still has one awaiting
    // payment (stale ones are auto-expired first, so they don't wrongly block). Prevents
    // contradictory duplicate pending orders.
    const existing = await this.jobs.listByCustomer(customerId);
    for (const j of existing) {
      const fresh = await this.expireIfStale(j);
      if (fresh.status === 'CREATED') {
        throw new ConflictException({
          message: 'You have an order awaiting payment. Please complete or cancel it first.',
          pendingJobId: fresh.id,
        });
      }
    }

    const job: Job = {
      id: randomUUID(), type: v.payload.type, status: 'CREATED', customerId,
      // Refunds default to the original payment source; 'source' is the sentinel for that.
      amountMinor: v.payload.amountMinor, currency: 'NGN', refundAccountId: dto.refundAccountId ?? 'source',
      pickup: v.payload.pickup, dropoff: v.payload.dropoff,
      ...(dto.pickupAddress ? { pickupAddress: dto.pickupAddress } : {}),
      ...(dto.dropoffAddress ? { dropoffAddress: dto.dropoffAddress } : {}),
      ...(dto.pickupArea ? { pickupArea: dto.pickupArea } : {}),
      ...(dto.dropoffArea ? { dropoffArea: dto.dropoffArea } : {}),
      ...(dto.recipient ? { recipient: dto.recipient } : {}),
      ...(dto.item ? { item: dto.item } : {}),
      ...(dto.instructions ? { instructions: dto.instructions } : {}),
      ...(dto.fallbackPolicy ? { fallbackPolicy: dto.fallbackPolicy } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.jobs.create(job);

    // Default return is the web tracking page. The mobile app may request a return to its own
    // deep-link scheme — allow-listed to `rydafirst://` only, so this can't become an open redirect.
    const redirectUrl = dto.returnUrl?.startsWith('rydafirst://')
      ? dto.returnUrl
      : `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
    const email = `customer.${customerId}@rydafirst.app`; // TODO: use the customer's real email
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(job.amountMinor), email, redirectUrl);
    await this.jobs.setPaymentRefs(job.id, { txRef });
    return { ...job, flwTxRef: txRef, paymentLink: link };
  }

  /** Called by the verified payment webhook: confirm funding, open for matching. */
  async confirmFundedByTxRef(verified: VerifiedTxn): Promise<{ funded: boolean }> {
    const job = await this.jobs.findByTxRef(verified.txRef);
    if (!job) return { funded: false };
    await this.escrow.confirmFunding(job.id, verified);
    await this.jobs.setPaymentRefs(job.id, { txId: verified.transactionId });
    if (job.status === 'CREATED') {
      assertTransition('CREATED', 'FUNDED');
      await this.jobs.updateStatus(job.id, 'FUNDED');
      assertTransition('FUNDED', 'SEARCHING');
      await this.jobs.updateStatus(job.id, 'SEARCHING');
      await this.notify.record(job.customerId, { title: 'Payment received', body: 'Your payment is held safely in escrow. We’re finding you a rider now.', jobId: job.id });
      await this.announceToOnlineRiders(job.id);
    }
    return { funded: true };
  }

  /** Verify-on-return: verify the Flutterwave transaction and fund the job (webhook-independent). */
  async confirmPayment(actorId: string, jobId: string, transactionId: string): Promise<{ funded: boolean; status: string }> {
    const job = await this.getJob(actorId, jobId); // owner check (also lazily expires stale unpaid jobs)
    // Only an open, unpaid order can be funded. If the window closed (CANCELLED) or it's already
    // funded, do NOT capture money — this prevents a late payment landing on a cancelled order.
    if (job.status !== 'CREATED') return { funded: false, status: job.status };
    const verified = await this.escrow.verifyTransaction(transactionId);
    if (verified.status !== 'successful') return { funded: false, status: verified.status };
    await this.escrow.confirmFunding(job.id, verified);
    await this.jobs.setPaymentRefs(job.id, { txId: verified.transactionId });
    if (job.status === 'CREATED') {
      assertTransition('CREATED', 'FUNDED');
      await this.jobs.updateStatus(job.id, 'FUNDED');
      assertTransition('FUNDED', 'SEARCHING');
      await this.jobs.updateStatus(job.id, 'SEARCHING');
      await this.notify.record(job.customerId, { title: 'Payment received', body: 'Your payment is held safely in escrow. We’re finding you a rider now.', jobId: job.id });
      await this.announceToOnlineRiders(job.id);
    }
    return { funded: true, status: 'FUNDED' };
  }

  async accept(riderId: string, jobId: string): Promise<Job> {
    // Fail-closed: an uncleared rider can't take a job even by calling this endpoint directly
    // (the go-online gate isn't the only enforcement point). Toggle with ENFORCE_RIDER_CLEARANCE.
    if (this.env.ENFORCE_RIDER_CLEARANCE && !(await this.documents.isRiderCleared(riderId))) {
      throw new ForbiddenException('Complete your document verification before accepting jobs');
    }
    const claimed = await this.jobs.claim(jobId, riderId);
    if (!claimed) throw new ConflictException('Job is no longer available');
    const job = await this.mustFind(jobId);
    await this.notify.record(job.customerId, { title: 'Rider assigned', body: 'A rider accepted your delivery and is on the way to pickup.', jobId, urgent: true });
    return job;
  }

  /**
   * Rider releases an accepted job back to the pool (before pickup only) so another rider is
   * matched. No money moves — the escrow stays held and the order returns to SEARCHING. Rate-capped
   * per rider to discourage accept-then-drop abuse.
   */
  async releaseJob(riderId: string, jobId: string): Promise<{ status: JobStatus }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (!canReleaseJob(job.status)) {
      throw new ConflictException('You can only release a job before pickup');
    }
    const withinCap = await this.limiter.hit(`release:${riderId}`, MAX_RIDER_RELEASES_PER_DAY, RELEASE_WINDOW_SECONDS);
    if (!withinCap) {
      throw new ConflictException('You have released too many jobs today. Please contact support.');
    }
    assertTransition(job.status, 'SEARCHING');
    await this.jobs.release(jobId);
    await this.notify.record(job.customerId, { title: 'Finding a new rider', body: 'Your rider couldn’t continue, so we’re matching another rider for you.', jobId });
    // Re-offer to the pool, excluding the rider who just handed it back.
    await this.announceToOnlineRiders(jobId, riderId);
    return { status: 'SEARCHING' };
  }

  async advance(riderId: string, jobId: string, to: JobStatus): Promise<Job> {
    if (!PROGRESS_STEPS.includes(to)) throw new BadRequestException('Not a progress step');
    // Reaching the pickup ("AT_PICKUP") is GPS-gated — use arriveAtPickup instead.
    if (to === 'AT_PICKUP') throw new BadRequestException('Confirm arrival at pickup with GPS');
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, to);
    await this.jobs.updateStatus(jobId, to);
    return this.mustFind(jobId);
  }

  /** GPS-verified arrival at the PICKUP (mirrors drop-off arrival). */
  async arriveAtPickup(riderId: string, jobId: string, riderPos: GeoPoint): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'AT_PICKUP');
    if (!isWithinGeofence(riderPos, job.pickup, this.env.ARRIVAL_RADIUS_M)) {
      throw new BadRequestException('Not within the pickup location');
    }
    await this.jobs.updateStatus(jobId, 'AT_PICKUP');
    return this.mustFind(jobId);
  }

  async markArrived(riderId: string, jobId: string, riderPos: GeoPoint): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'ARRIVED');
    if (!isWithinGeofence(riderPos, job.dropoff, this.env.ARRIVAL_RADIUS_M)) {
      throw new BadRequestException('Not within the drop location');
    }
    await this.jobs.updateStatus(jobId, 'ARRIVED');
    await this.jobs.setArrivedAt(jobId, Date.now()); // start the waiting clock for WAIT-policy metering
    return this.mustFind(jobId);
  }

  /** Complete a delivery after a valid code: release escrow (transfer to rider). */
  async completeDelivery(riderId: string, jobId: string): Promise<{ status: JobStatus }> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'COMPLETED');
    await this.jobs.updateStatus(jobId, 'COMPLETED');
    const riderPayout = await this.payout.getPayout(riderId);
    await this.escrow.settle({
      jobId, status: 'COMPLETED', outcome: 'RELEASE_FULL', collected: Money.of(job.amountMinor),
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
    });
    assertTransition('COMPLETED', 'RELEASED');
    await this.jobs.updateStatus(jobId, 'RELEASED');
    await this.notify.record(job.customerId, { title: 'Delivered', body: 'Your delivery is complete. Thanks for riding with Rydafirst.', jobId });
    await this.notify.record(riderId, { title: 'Payment released', body: 'Delivery confirmed — your earnings have been released.', jobId });
    return { status: 'RELEASED' };
  }

  async failedAttempt(riderId: string, jobId: string): Promise<{ status: JobStatus; attemptFeeMinor: number; waitingFeeMinor: number }> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'FAILED_ATTEMPT');
    await this.jobs.updateStatus(jobId, 'FAILED_ATTEMPT');

    // Fee math is a pure, tested domain function: base attempt fee + metered waiting fee for the
    // WAIT policy (10-min grace, then ₦50/min, capped), and never more than the amount collected.
    // Elapsed time is server-authoritative (arrivedAt is set on GPS-verified arrival).
    const feeCalc = failedAttemptFee({
      collectedMinor: job.amountMinor,
      policy: job.fallbackPolicy,
      arrivedAtMs: job.arrivedAt,
      nowMs: Date.now(),
    });
    const fee = Money.of(feeCalc.totalMinor);

    const riderPayout = await this.payout.getPayout(riderId);
    await this.escrow.settle({
      jobId, status: 'FAILED_ATTEMPT', outcome: 'FAILED_ATTEMPT', collected: Money.of(job.amountMinor), attemptFee: fee,
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
    });
    await this.notify.record(job.customerId, { title: 'Delivery attempt failed', body: 'The rider couldn’t complete the drop-off. Please check your order for next steps.', jobId, urgent: true });
    return { status: 'FAILED_ATTEMPT', attemptFeeMinor: fee.amount, waitingFeeMinor: feeCalc.waitingMinor };
  }

  async getJob(actorId: string, jobId: string): Promise<Job> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();
    return this.expireIfStale(job);
  }

  /** The assigned rider's public details (name, vehicle) for the job's customer or rider to see. */
  async assignedRiderSummary(actorId: string, jobId: string): Promise<{
    rider: (Awaited<ReturnType<DocumentsService['riderSummaryFor']>> & { rating: number; ratingCount: number }) | null;
  }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();
    if (!job.riderId) return { rider: null };
    const rider = await this.documents.riderSummaryFor(job.riderId);
    const { average, count } = await this.ratings.averageForRider(job.riderId);
    return { rider: { ...rider, rating: average, ratingCount: count } };
  }

  /** Customer rates the rider on a completed delivery (one rating per job, fail-closed). */
  async rateJob(customerId: string, jobId: string, input: { stars: number; comment?: string }): Promise<Rating> {
    if (!isValidStars(input.stars)) throw new BadRequestException('Rating must be from 1 to 5 stars');
    const job = await this.mustFind(jobId);
    if (job.customerId !== customerId) throw new ForbiddenException();
    if (!['COMPLETED', 'RELEASED'].includes(job.status)) throw new ConflictException('You can only rate a completed delivery');
    if (!job.riderId) throw new ConflictException('This delivery had no rider to rate');
    if (await this.ratings.hasRatingForJob(jobId)) throw new ConflictException('You already rated this delivery');
    return this.ratings.record({
      jobId, riderId: job.riderId, customerId, stars: input.stars,
      ...(input.comment ? { comment: input.comment } : {}),
    });
  }

  /** Completed deliveries the customer hasn't rated yet — drives the rating prompt. */
  async pendingRatings(customerId: string): Promise<Array<{ jobId: string; amountMinor: number; createdAt: string; dropoffArea?: string; riderName?: string }>> {
    const jobs = await this.jobs.listByCustomer(customerId);
    const done = jobs.filter((j) => ['COMPLETED', 'RELEASED'].includes(j.status) && j.riderId);
    const out: Array<{ jobId: string; amountMinor: number; createdAt: string; dropoffArea?: string; riderName?: string }> = [];
    for (const j of done) {
      if (await this.ratings.hasRatingForJob(j.id)) continue;
      const summary = j.riderId ? await this.documents.riderSummaryFor(j.riderId) : null;
      out.push({
        jobId: j.id, amountMinor: j.amountMinor, createdAt: j.createdAt,
        ...(j.dropoffArea ? { dropoffArea: j.dropoffArea } : {}),
        ...(summary?.name ? { riderName: summary.name } : {}),
      });
    }
    return out;
  }

  /** A customer's order history, newest first (unpaid orders past the window are auto-cancelled). */
  async myJobs(customerId: string): Promise<Job[]> {
    const jobs = await this.jobs.listByCustomer(customerId);
    const out: Job[] = [];
    for (const j of jobs) out.push(await this.expireIfStale(j));
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Auto-cancel an unpaid order once the payment window elapses. No funds captured => safe.
   *  The "is it expired?" decision is the pure `isPaymentExpired` domain rule; here we only
   *  perform the guarded state transition. */
  private async expireIfStale(job: Job): Promise<Job> {
    const windowMs = this.env.PAYMENT_WINDOW_MINUTES * 60_000;
    if (!isPaymentExpired(job.status, Date.parse(job.createdAt), Date.now(), windowMs)) return job;
    assertTransition('CREATED', 'CANCELLED');
    await this.jobs.updateStatus(job.id, 'CANCELLED');
    return { ...job, status: 'CANCELLED' };
  }

  async cancel(actorId: string, jobId: string): Promise<{ status: JobStatus; refunded: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    const policy = cancellationPolicy(job.status);
    if (!policy.allowed) throw new ConflictException('Job can no longer be cancelled');
    await this.jobs.updateStatus(jobId, 'CANCELLED');
    if (policy.refundFull) {
      await this.escrow.settle({
        jobId, status: 'CANCELLED', outcome: 'REFUND_FULL', collected: Money.of(job.amountMinor),
        ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
      });
    }
    await this.notify.record(job.customerId, {
      title: 'Order cancelled',
      body: policy.refundFull ? 'Your order was cancelled and the full amount refunded.' : 'Your order was cancelled.',
      jobId, urgent: true,
    });
    if (job.riderId) {
      await this.notify.record(job.riderId, { title: 'Order cancelled', body: 'A delivery you accepted was cancelled by the customer.', jobId, urgent: true });
    }
    return { status: 'CANCELLED', refunded: policy.refundFull };
  }

  async openDispute(actorId: string, jobId: string): Promise<{ status: JobStatus }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();
    assertTransition(job.status, 'DISPUTED');
    await this.jobs.updateStatus(jobId, 'DISPUTED');
    return { status: 'DISPUTED' };
  }

  async resolveDispute(jobId: string, resolution: Resolution, opts: { riderShareMinor?: number } = {}): Promise<{ status: JobStatus }> {
    const job = await this.mustFind(jobId);
    assertTransition(job.status, 'DISPUTE_RESOLVED');
    await this.jobs.updateStatus(jobId, 'DISPUTE_RESOLVED');
    const riderPayout = await this.payout.getPayout(job.riderId ?? '');
    await this.escrow.settle({
      jobId, status: 'DISPUTE_RESOLVED', outcome: resolutionToSettlement(resolution),
      collected: Money.of(job.amountMinor),
      ...(opts.riderShareMinor !== undefined ? { riderShare: Money.of(opts.riderShareMinor) } : {}),
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
    });
    return { status: 'DISPUTE_RESOLVED' };
  }

  async listActiveJobs(): Promise<Job[]> { return this.jobs.listActive(); }
  async jobsForRider(riderId: string): Promise<Job[]> { return this.jobs.listByRider(riderId); }

  /**
   * Jobs an online rider can currently accept: funded and still searching for a rider.
   * (First-accept-wins is enforced atomically in accept(); this is only the discovery feed.)
   * Newest first. In production this is filtered by the rider's geo proximity via the matching module.
   *
   * SECURITY: returns a trimmed, PII-free projection — a rider sees only what they need to
   * decide (type, fare, pickup/dropoff coords). Recipient name/phone, customerId and the
   * refund account are NOT exposed until the rider actually claims the job.
   */
  async availableJobs(): Promise<AvailableJob[]> {
    const active = await this.jobs.listActive();
    return active
      .filter((j) => j.status === 'SEARCHING')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => ({
        id: j.id,
        type: j.type,
        amountMinor: j.amountMinor,
        currency: j.currency,
        createdAt: j.createdAt,
        // Prefer the neighbourhood captured at booking; fall back to parsing the full address.
        pickupArea: j.pickupArea || coarseArea(j.pickupAddress),
        dropoffArea: j.dropoffArea || coarseArea(j.dropoffAddress),
        // Approximate (area-level) pin so a rider can see where jobs are without the exact address.
        pickupApprox: approximatePoint(j.pickup),
      }));
  }
  async status(jobId: string): Promise<JobStatus> { return (await this.mustFind(jobId)).status; }

  private async assertAssigned(jobId: string, riderId: string): Promise<Job> {
    const job = await this.mustFind(jobId);
    if (job.riderId !== riderId) throw new ForbiddenException('Not your job');
    return job;
  }
  private async mustFind(id: string): Promise<Job> {
    const job = await this.jobs.find(id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
