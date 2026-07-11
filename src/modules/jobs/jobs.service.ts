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
import { failedAttemptFee } from './domain/failed-attempt-fee.js';
import { isPaymentExpired } from './domain/payment-window.js';
import { coarseArea } from './domain/area.js';
import { resolutionToSettlement, type Resolution } from '../disputes/domain/dispute.js';
import { JOB_REPO, type Job, type JobRepository } from './ports.js';
import { RIDER_PAYOUT, type RiderPayoutSource } from './rider-payout.port.js';
import type { QuoteRequestDto, CreateJobDto } from './dto/jobs.dto.js';

const QUOTE_TTL_MS = 120_000;
const PROGRESS_STEPS: readonly JobStatus[] = ['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'];

export type CreatedJob = Job & { paymentLink: string };

/** PII-free projection shown to riders in the discovery feed. Only a COARSE area is exposed
 *  pre-accept (no exact coordinates, no recipient/customer/refund data). */
export type AvailableJob = Pick<Job, 'id' | 'type' | 'amountMinor' | 'currency' | 'createdAt'>
  & { pickupArea: string; dropoffArea: string };

@Injectable()
export class JobsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(JOB_REPO) private readonly jobs: JobRepository,
    @Inject(RIDER_PAYOUT) private readonly payout: RiderPayoutSource,
    private readonly escrow: EscrowService,
  ) {}

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

    const redirectUrl = `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
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
    }
    return { funded: true, status: 'FUNDED' };
  }

  async accept(riderId: string, jobId: string): Promise<Job> {
    const claimed = await this.jobs.claim(jobId, riderId);
    if (!claimed) throw new ConflictException('Job is no longer available');
    return this.mustFind(jobId);
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
    return { status: 'FAILED_ATTEMPT', attemptFeeMinor: fee.amount, waitingFeeMinor: feeCalc.waitingMinor };
  }

  async getJob(actorId: string, jobId: string): Promise<Job> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();
    return this.expireIfStale(job);
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
