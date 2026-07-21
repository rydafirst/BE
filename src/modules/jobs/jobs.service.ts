import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { Money } from '../payments/domain/money.js';
import { EscrowService, type SettleResult } from '../payments/escrow.service.js';
import type { VerifiedTxn } from '../payments/payment-provider.interface.js';
import { assertTransition, canTransition, isDeliveryComplete, type JobStatus } from './domain/job-state-machine.js';
import { computeFare, type FareBreakdown } from './domain/fare.js';
import { haversineMeters, type GeoPoint } from './domain/geo.js';
import { isWithinGeofence } from '../confirmations/domain/geofence.js';
import { signQuote, verifyQuote } from './domain/quote-token.js';
import { cancellationPolicy } from './domain/cancellation.js';
import { canReleaseJob, MAX_RIDER_RELEASES_PER_DAY, RELEASE_WINDOW_SECONDS } from './domain/rider-release.js';
import { failedAttemptFee } from './domain/failed-attempt-fee.js';
import { accruedWaitingMinor, computeReturnFareMinor, graceElapsed } from './domain/resolution.js';
import { decideFunding } from './domain/funding.js';
import { FARE_CONFIG } from './domain/fare.js';
import { isPaymentExpired } from './domain/payment-window.js';
import { resolutionToSettlement, type Resolution } from '../disputes/domain/dispute.js';
import { JOB_REPO, type Job, type JobRepository } from './ports.js';
import { RATE_LIMITER, type RateLimiter } from '../auth/ports.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { RatingsService } from '../ratings/ratings.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RIDER_ACCOUNT_STATUS, type RiderAccountStatus } from '../accounts/rider-account-status.port.js';
import { ridersToAnnounce } from './domain/broadcast.js';
import { RIDER_PAYOUT, type RiderPayoutSource } from './rider-payout.port.js';
import { CUSTOMER_EMAIL, type CustomerEmailSource } from './customer-email.port.js';
import { CUSTOMER_PHOTO, type CustomerPhotoSource } from './customer-photo.port.js';
import { CONTACT_CHANNEL, type ContactChannel } from './contact-channel.port.js';
import { JOB_STATUS_LOG, type JobStatusLog } from './status-log.port.js';
import { contactAllowed } from './domain/contact-window.js';
import type { QuoteRequestDto, CreateJobDto } from './dto/jobs.dto.js';

const QUOTE_TTL_MS = 900_000; // 15 minutes — long enough to read options + pay without the quote going stale
const PROGRESS_STEPS: readonly JobStatus[] = ['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'];

export type CreatedJob = Job & { paymentLink: string };
// The rider job board moved to JobDiscoveryService; re-exported so existing imports keep working.
export type { AvailableJob } from './job-discovery.service.js';


@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);

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
    private readonly settings: SettingsService,
    @Inject(RIDER_ACCOUNT_STATUS) private readonly riderAccount: RiderAccountStatus,
    @Inject(CUSTOMER_EMAIL) private readonly customerEmail: CustomerEmailSource,
    @Inject(CUSTOMER_PHOTO) private readonly customerPhoto: CustomerPhotoSource,
    @Inject(CONTACT_CHANNEL) private readonly contact: ContactChannel,
    @Inject(JOB_STATUS_LOG) private readonly statusLog: JobStatusLog,
  ) {}

  /** The customer's name + photo for the assigned rider (party-only, after they're on the job). */
  async assignedCustomerSummary(riderId: string, jobId: string): Promise<{ name?: string; photoUrl?: string; phone?: string; phoneMasked?: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.riderId !== riderId) throw new ForbiddenException();
    const photoUrl = await this.customerPhoto.photoUrl(job.customerId);
    const contact = await this.contactFor(job, riderId, job.customerId);
    return {
      ...(job.customerName ? { name: job.customerName } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      ...contact,
    };
  }

  /**
   * A number one party of a job may dial to reach the other, or nothing.
   *
   * Three gates, all required: the job must still be in flight (`contactAllowed`), the caller must
   * already have been verified as a party to it, and the channel must actually return a number.
   * Omitted entirely rather than returned as null so a phone number never appears in a payload for
   * a job that has ended.
   */
  private async contactFor(job: Job, callerUserId: string, subjectUserId: string): Promise<{ phone?: string; phoneMasked?: boolean }> {
    if (!contactAllowed(job.status)) return {};
    const contact = await this.contact.numberFor({ jobId: job.id, callerUserId, subjectUserId });
    return contact.number ? { phone: contact.number, phoneMasked: contact.masked } : {};
  }

  /**
   * The email used on the customer's Flutterwave collection — their real address when we have it
   * (so receipts reach a real inbox), with a stable synthetic fallback so a checkout never fails.
   */
  private async collectionEmail(customerId: string): Promise<string> {
    return (await this.customerEmail.getEmail(customerId)) ?? `customer.${customerId}@rydafirst.app`;
  }

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

    // Recompute the fare from the signed pickup/dropoff so we know the exact platform fee to split
    // out on release. Deterministic, so it reproduces the quote; if the signed total doesn't match,
    // the quote was tampered with or pricing drifted — reject rather than mis-charge.
    const fare = computeFare(v.payload.type, haversineMeters(v.payload.pickup, v.payload.dropoff));
    if (fare.totalMinor !== v.payload.amountMinor) {
      throw new BadRequestException('Quote no longer valid — please refresh your price');
    }

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

    // "Return insurance": if the customer pre-declares RETURN at booking, we pre-charge the 75%
    // return fee on top of the fare and hold it in escrow. It's refunded if the delivery succeeds,
    // or released to the rider as the return leg if it actually comes back. Added server-side (not
    // from the client), so the fare tamper-guard above still holds on the signed quote amount.
    const returnReserveMinor = dto.fallbackPolicy === 'RETURN' ? computeReturnFareMinor(fare.totalMinor) : 0;
    const chargeMinor = v.payload.amountMinor + returnReserveMinor;

    const job: Job = {
      id: randomUUID(), type: v.payload.type, status: 'CREATED', customerId,
      ...(dto.customerName ? { customerName: dto.customerName } : {}),
      // Refunds default to the original payment source; 'source' is the sentinel for that.
      amountMinor: chargeMinor, platformFeeMinor: fare.platformFeeMinor,
      ...(returnReserveMinor > 0 ? { returnReserveMinor } : {}),
      currency: 'NGN', refundAccountId: dto.refundAccountId ?? 'source',
      pickup: v.payload.pickup, dropoff: v.payload.dropoff,
      ...(dto.pickupAddress ? { pickupAddress: dto.pickupAddress } : {}),
      ...(dto.dropoffAddress ? { dropoffAddress: dto.dropoffAddress } : {}),
      ...(dto.pickupArea ? { pickupArea: dto.pickupArea } : {}),
      ...(dto.dropoffArea ? { dropoffArea: dto.dropoffArea } : {}),
      ...(dto.recipient ? { recipient: dto.recipient } : {}),
      ...(dto.item ? { item: dto.item } : {}),
      ...(dto.weightKg != null ? { weightGrams: Math.round(dto.weightKg * 1000) } : {}),
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
    const email = await this.collectionEmail(customerId);
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(job.amountMinor), email, redirectUrl);
    await this.jobs.setPaymentRefs(job.id, { txRef });
    return { ...job, flwTxRef: txRef, paymentLink: link };
  }

  /** Called by the verified payment webhook: confirm funding, open for matching. */
  async confirmFundedByTxRef(verified: VerifiedTxn): Promise<{ funded: boolean }> {
    const job = await this.jobs.findByTxRef(verified.txRef);
    if (!job) return { funded: false };
    // A waiting-fee charge rides on a distinct txRef: fund the waiting surcharge, not the fare.
    if (job.waitingTxRef === verified.txRef) {
      if (!job.waitingTxId) {
        await this.escrow.confirmWaitingFunding(job.id, verified);
        await this.jobs.setWaitingRefs(job.id, { txId: verified.transactionId });
        if (job.riderId) {
          await this.notify.record(job.riderId, { title: 'Waiting fee paid', body: 'The customer paid the waiting fee — you can hand over the package now.', jobId: job.id, urgent: true });
        }
      }
      return { funded: true };
    }
    // Defense in depth: the job is already bound by txRef (findByTxRef), but never fund on an
    // underpayment — the escrow hold must cover the fare we later release to the rider.
    if (verified.amountMinor < job.amountMinor) return { funded: false };
    await this.escrow.confirmFunding(job.id, verified);
    await this.jobs.setPaymentRefs(job.id, { txId: verified.transactionId });
    if (job.status === 'CREATED') {
      assertTransition('CREATED', 'FUNDED');
      await this.transitionTo(job.id, 'FUNDED');
      assertTransition('FUNDED', 'SEARCHING');
      await this.transitionTo(job.id, 'SEARCHING');
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
    // SECURITY: bind the transaction to THIS job's own checkout and require the full amount, so a
    // caller can't fund an expensive order with a cheap/unrelated/reused payment id (pure, tested).
    const decision = decideFunding({
      jobFlwTxRef: job.flwTxRef, jobAmountMinor: job.amountMinor,
      verifiedTxRef: verified.txRef, verifiedAmountMinor: verified.amountMinor,
    });
    if (!decision.ok) return { funded: false, status: decision.reason };
    await this.escrow.confirmFunding(job.id, verified);
    await this.jobs.setPaymentRefs(job.id, { txId: verified.transactionId });
    if (job.status === 'CREATED') {
      assertTransition('CREATED', 'FUNDED');
      await this.transitionTo(job.id, 'FUNDED');
      assertTransition('FUNDED', 'SEARCHING');
      await this.transitionTo(job.id, 'SEARCHING');
      await this.notify.record(job.customerId, { title: 'Payment received', body: 'Your payment is held safely in escrow. We’re finding you a rider now.', jobId: job.id });
      await this.announceToOnlineRiders(job.id);
    }
    return { funded: true, status: 'FUNDED' };
  }

  async accept(riderId: string, jobId: string): Promise<Job> {
    // Fail-closed: an uncleared rider can't take a job even by calling this endpoint directly
    // (the go-online gate isn't the only enforcement point). Toggle via admin settings.
    if ((await this.settings.enforceRiderClearance()) && !(await this.documents.isRiderCleared(riderId))) {
      throw new ForbiddenException('Complete your document verification before accepting jobs');
    }
    // A rider with no saved payout account has nowhere to be paid — block acceptance outright
    // (always enforced, not behind the clearance toggle).
    if (!(await this.riderAccount.hasAccount(riderId))) {
      throw new ForbiddenException('Add your payout bank account before accepting jobs');
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
    // Time-critical: the customer's in-flight delivery has stalled and they need to know now.
    await this.notify.record(job.customerId, { title: 'Finding a new rider', body: 'Your rider couldn’t continue, so we’re matching another rider for you.', jobId, urgent: true });
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
    await this.transitionTo(jobId, to);
    return this.mustFind(jobId);
  }

  /** GPS-verified arrival at the PICKUP (mirrors drop-off arrival). */
  async arriveAtPickup(riderId: string, jobId: string, riderPos: GeoPoint): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'AT_PICKUP');
    if (!isWithinGeofence(riderPos, job.pickup, this.env.ARRIVAL_RADIUS_M)) {
      throw new BadRequestException('Not within the pickup location');
    }
    await this.transitionTo(jobId, 'AT_PICKUP');
    return this.mustFind(jobId);
  }

  async markArrived(riderId: string, jobId: string, riderPos: GeoPoint): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'ARRIVED');
    if (!isWithinGeofence(riderPos, job.dropoff, this.env.ARRIVAL_RADIUS_M)) {
      throw new BadRequestException('Not within the drop location');
    }
    await this.transitionTo(jobId, 'ARRIVED');
    await this.jobs.setArrivedAt(jobId, Date.now()); // start the waiting clock for WAIT-policy metering
    return this.mustFind(jobId);
  }

  /** Complete a delivery after a valid code: release escrow (transfer to rider). */
  async completeDelivery(riderId: string, jobId: string): Promise<{ status: JobStatus }> {
    const job = await this.assertAssigned(jobId, riderId);
    // Enforce "pay before handover": if a waiting fee was raised, it must be funded before the rider
    // completes — otherwise the rider would give up the package without being paid for the wait.
    if (job.waitingFeeMinor && !job.waitingTxId) {
      throw new ConflictException('The waiting fee has not been paid yet — ask the customer to pay before handover');
    }
    await this.releaseFullToRider(job, riderId);
    // Delivered successfully: the pre-charged "return insurance" reserve wasn't needed -> refund it.
    if (job.returnReserveMinor && job.flwTxId) {
      await this.escrow.refundReturnReserveToCustomer(jobId, Money.of(job.returnReserveMinor), job.flwTxId);
    }
    await this.notify.record(job.customerId, {
      title: 'Delivered',
      body: job.returnReserveMinor
        ? 'Your delivery is complete and your return deposit has been refunded. Thanks for riding with Rydafirst.'
        : 'Your delivery is complete. Thanks for riding with Rydafirst.',
      jobId,
    });
    return { status: 'RELEASED' };
  }

  /**
   * The single writer of a job's payout state.
   *
   * Payout state must be written from here and NOWHERE else on a settle path. The external
   * disbursement can complete after `settle()` has already returned, so a caller that also wrote the
   * flag from the returned result would race the deferred update — and could overwrite a payout that
   * actually succeeded with the stale "queued" value, stranding the job in the retry queue.
   *
   * Called once with the queued state and again with the real outcome; the write is a last-write-wins
   * upsert, so repeating it is harmless.
   */
  private recordPayoutState(jobId: string): (r: SettleResult) => Promise<void> {
    return async (r) => {
      await this.jobs.setPayoutState(jobId, { pending: r.payoutPending, error: r.payoutError ?? null, ref: r.providerRef || null });
    };
  }

  /**
   * Release the full outbound fare to the rider (rider gets base+distance, platform keeps its fee).
   * Shared by a normal completion AND by initiating a return — in both cases the rider did the job,
   * so they are paid in full and the customer is NOT refunded. Idempotent + durable via escrow.settle.
   */
  private async releaseFullToRider(job: Job, riderId: string): Promise<SettleResult> {
    assertTransition(job.status, 'COMPLETED');
    await this.transitionTo(job.id, 'COMPLETED');
    const riderPayout = await this.payout.getPayout(riderId);
    // Release only the FARE portion here; any pre-charged return reserve is settled separately by
    // the caller (refunded on delivery, or paid to the rider on an actual return).
    const fareMinor = job.amountMinor - (job.returnReserveMinor ?? 0);

    // Confirm the DELIVERY as soon as it is durable, independently of the money leaving the bank.
    // These are two different facts to the rider and they no longer arrive together: the payout may
    // settle after this request has been answered.
    await this.notify.record(riderId, {
      title: 'Delivery confirmed',
      body: 'Nice work — the delivery is confirmed. Your earnings are on the way.',
      jobId: job.id,
      urgent: true,
    });

    const recordPayout = this.recordPayoutState(job.id);
    const res = await this.escrow.settle({
      jobId: job.id, status: 'COMPLETED', outcome: 'RELEASE_FULL', collected: Money.of(fareMinor),
      platformFee: Money.of(job.platformFeeMinor ?? 0),
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
      onPayoutSettled: async (r) => {
        await recordPayout(r);
        // Fires exactly once, whenever the money actually lands — inline during this call, or later
        // from the deferred attempt. Reading `res.payoutPending` after settle() cannot do this: with
        // a deferred payout it is always "pending", so the rider would never hear that they were paid.
        if (!r.payoutPending) {
          await this.notify.record(riderId, {
            title: 'Payment released',
            body: 'Your earnings for this delivery have been released.',
            jobId: job.id,
            urgent: true,
          });
        }
      },
    });
    assertTransition('COMPLETED', 'RELEASED');
    await this.transitionTo(job.id, 'RELEASED');
    // If a waiting fee was funded, release it 100% to the rider on top of the fare (idempotent).
    if (job.waitingFeeMinor && job.waitingTxId) {
      await this.escrow.settleWaitingToRider(job.id, Money.of(job.waitingFeeMinor), riderPayout ?? undefined);
    }
    return res;
  }

  /**
   * Rider raises the metered waiting fee once the free grace has passed. Charges the SENDER a
   * separate collection (never carved from the fare); the rider may only hand over once it's paid.
   */
  async chargeWaiting(riderId: string, jobId: string): Promise<{ waitingFeeMinor: number; paymentLink: string; flwTxRef: string }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (job.status !== 'WAITING') throw new ConflictException('Start the wait timer first');
    if (job.waitStartedAt == null || !graceElapsed(job.waitStartedAt, Date.now())) {
      throw new ConflictException('The 10-minute free grace has not elapsed yet');
    }
    if (job.waitingTxId) throw new ConflictException('The waiting fee has already been paid');
    const amount = accruedWaitingMinor(job.waitStartedAt, Date.now());
    if (amount <= 0) throw new ConflictException('No waiting fee has accrued yet');
    const redirectUrl = `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
    const email = await this.collectionEmail(job.customerId);
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(amount), email, redirectUrl);
    await this.jobs.setWaitingRefs(job.id, { txRef, feeMinor: amount });
    await this.notify.record(job.customerId, {
      title: 'Waiting fee due', body: 'Your rider waited past the free 10 minutes. Please pay the waiting fee so they can hand over your package.', jobId, urgent: true,
    });
    return { waitingFeeMinor: amount, paymentLink: link, flwTxRef: txRef };
  }

  /**
   * Customer-facing: create (or re-quote) the waiting-fee charge and return a payment link for the
   * sender to pay. Same money path as the rider's request, but authorised to the customer who pays.
   */
  async payWaiting(actorId: string, jobId: string): Promise<{ waitingFeeMinor: number; paymentLink: string; flwTxRef: string }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    if (job.status !== 'WAITING' && job.status !== 'AWAITING_RESOLUTION') {
      throw new ConflictException('There is no waiting fee to pay right now');
    }
    if (job.waitingTxId) throw new ConflictException('The waiting fee has already been paid');
    if (job.waitStartedAt == null || !graceElapsed(job.waitStartedAt, Date.now())) {
      throw new ConflictException('The 10-minute free grace has not elapsed yet');
    }
    const amount = accruedWaitingMinor(job.waitStartedAt, Date.now());
    if (amount <= 0) throw new ConflictException('No waiting fee has accrued yet');
    // Keeping the rider waiting resumes the metered wait if we were awaiting a decision.
    if (job.status === 'AWAITING_RESOLUTION') await this.transitionTo(jobId, 'WAITING');
    const redirectUrl = `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
    const email = await this.collectionEmail(job.customerId);
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(amount), email, redirectUrl);
    await this.jobs.setWaitingRefs(job.id, { txRef, feeMinor: amount });
    return { waitingFeeMinor: amount, paymentLink: link, flwTxRef: txRef };
  }

  /** Verify-on-return confirmation for a waiting-fee payment (webhook-independent). */
  async confirmWaitingPayment(actorId: string, jobId: string, transactionId: string): Promise<{ funded: boolean }> {
    const job = await this.getJob(actorId, jobId); // owner/party check
    if (!job.waitingTxRef || job.waitingTxId) return { funded: !!job.waitingTxId };
    const verified = await this.escrow.verifyTransaction(transactionId);
    if (verified.status !== 'successful') return { funded: false };
    await this.escrow.confirmWaitingFunding(job.id, verified);
    await this.jobs.setWaitingRefs(job.id, { txId: verified.transactionId });
    if (job.riderId) {
      await this.notify.record(job.riderId, { title: 'Waiting fee paid', body: 'The customer paid the waiting fee — you can hand over the package now.', jobId, urgent: true });
    }
    return { funded: true };
  }

  /**
   * Rider starts the wait timer at the drop-off. The first 10 minutes are FREE grace — the customer
   * is never charged for them. Metered charging only begins later, and only if the sender approves it.
   */
  async startWaiting(riderId: string, jobId: string): Promise<{ status: JobStatus; waitStartedAt: number }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (job.status === 'WAITING') return { status: 'WAITING', waitStartedAt: job.waitStartedAt ?? Date.now() };
    assertTransition(job.status, 'WAITING');
    const now = Date.now();
    await this.transitionTo(jobId, 'WAITING');
    await this.jobs.setWaitStartedAt(jobId, now);
    await this.notify.record(job.customerId, {
      title: 'Rider is waiting', body: 'Your rider is at the drop-off. The first 10 minutes are free while they wait for the recipient.', jobId, urgent: true,
    });
    return { status: 'WAITING', waitStartedAt: now };
  }

  /** Quote the two sender-paid options for a stalled delivery: keep waiting (metered) or return. */
  private resolutionQuote(job: Job): { waitingSoFarMinor: number; returnFareMinor: number } {
    const waitingSoFarMinor = job.waitStartedAt != null ? accruedWaitingMinor(job.waitStartedAt, Date.now()) : 0;
    return { waitingSoFarMinor, returnFareMinor: computeReturnFareMinor(job.amountMinor) };
  }

  /**
   * After the free grace elapses with no collection, the rider escalates. This moves the job to
   * AWAITING_RESOLUTION and asks the SENDER to choose keep-waiting (they pay ₦50/min) or return.
   * Blocked until the 10-minute grace has actually passed, so the customer is never charged early.
   */
  async escalateResolution(riderId: string, jobId: string): Promise<{ status: JobStatus; waitingSoFarMinor: number; returnFareMinor: number }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (job.status === 'AWAITING_RESOLUTION') return { status: job.status, ...this.resolutionQuote(job) };
    if (job.status !== 'WAITING') throw new ConflictException('Start the wait timer first');
    if (job.waitStartedAt == null || !graceElapsed(job.waitStartedAt, Date.now())) {
      throw new ConflictException('The 10-minute free grace has not elapsed yet');
    }
    assertTransition('WAITING', 'AWAITING_RESOLUTION');
    await this.transitionTo(jobId, 'AWAITING_RESOLUTION');
    const quote = this.resolutionQuote(job);
    await this.notify.record(job.customerId, {
      title: 'Action needed: recipient unavailable',
      body: 'Your rider waited past the free 10 minutes and no one has collected. Choose to keep waiting (₦50/min) or have it returned to you.',
      jobId, urgent: true,
    });
    return { status: 'AWAITING_RESOLUTION', ...quote };
  }

  /** Sender chooses to keep the rider waiting — the metered fee now applies (paid before handover). */
  async keepWaiting(actorId: string, jobId: string): Promise<{ status: JobStatus; waitingSoFarMinor: number }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    if (job.status !== 'AWAITING_RESOLUTION') throw new ConflictException('This delivery is not awaiting your decision');
    assertTransition('AWAITING_RESOLUTION', 'WAITING');
    await this.transitionTo(jobId, 'WAITING');
    if (job.riderId) {
      await this.notify.record(job.riderId, {
        title: 'Customer asked you to keep waiting',
        body: 'Please keep waiting — the metered waiting fee now applies and will be settled before you hand over the package.', jobId, urgent: true,
      });
    }
    return { status: 'WAITING', waitingSoFarMinor: this.resolutionQuote(job).waitingSoFarMinor };
  }

  /**
   * Sender initiates a return. The outbound is completed (rider paid in FULL — it wasn't their
   * fault), and a SEPARATE return leg is created for the sender to fund at 75% of the original fare.
   * The return charge is on top and never comes out of the rider's earnings.
   */
  async initiateReturn(actorId: string, jobId: string, returnUrl?: string): Promise<Job & { paymentLink?: string; prepaid?: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    if (job.status !== 'AWAITING_RESOLUTION' && job.status !== 'WAITING') {
      throw new ConflictException('A return can only be started while the rider is waiting on an undelivered package');
    }
    if (!job.riderId) throw new ConflictException('This delivery has no assigned rider');

    // 1) Pay the rider their full outbound fare (+ any already-funded waiting). Idempotent.
    await this.releaseFullToRider(job, job.riderId);

    const fareMinor = job.amountMinor - (job.returnReserveMinor ?? 0);
    // Waiting is ALWAYS owed once the rider waited past the free grace — delivered OR returned.
    // If it wasn't already collected separately, bill it together with the return below.
    const unpaidWaiting = job.waitStartedAt != null && !job.waitingTxId ? accruedWaitingMinor(job.waitStartedAt, Date.now()) : 0;

    // (A) Pre-declared "return insurance": the return leg is already paid for at booking. Release the
    // reserve to the rider as the return-leg payment — no new charge. (Any waiting is collected via
    // the normal waiting-fee flow during the wait and already paid out by releaseFullToRider above.)
    if (job.returnReserveMinor) {
      const riderPayout = await this.payout.getPayout(job.riderId);
      await this.escrow.settleReturnReserveToRider(jobId, Money.of(job.returnReserveMinor), riderPayout ?? undefined);
      await this.notify.record(job.customerId, { title: 'Return started', body: 'Your rider is bringing the package back — your pre-paid return covers it.', jobId, urgent: true });
      return { ...job, prepaid: true };
    }

    // (B) On-demand return: bill the sender for the 75% return fee + any unpaid waiting in ONE
    // collection. The waiting portion is 100% to the rider (platform fee only on the return fare).
    const returnFareTotal = computeReturnFareMinor(fareMinor);
    const returnPlatformFee = returnFareTotal - Math.round((returnFareTotal * 100) / (100 + FARE_CONFIG.platformFeePct));
    const returnTotal = returnFareTotal + unpaidWaiting;
    const returnJob: Job = {
      id: randomUUID(), type: 'DELIVERY', status: 'CREATED', customerId: job.customerId,
      amountMinor: returnTotal, platformFeeMinor: returnPlatformFee, currency: 'NGN',
      refundAccountId: job.refundAccountId,
      pickup: job.dropoff, dropoff: job.pickup,
      ...(job.dropoffAddress ? { pickupAddress: job.dropoffAddress } : {}),
      ...(job.pickupAddress ? { dropoffAddress: job.pickupAddress } : {}),
      ...(job.dropoffArea ? { pickupArea: job.dropoffArea } : {}),
      ...(job.pickupArea ? { dropoffArea: job.pickupArea } : {}),
      item: job.item ? `Return: ${job.item}` : 'Returned package',
      instructions: 'Return to sender — recipient was unavailable.',
      returnOfJobId: job.id,
      createdAt: new Date().toISOString(),
    };
    await this.jobs.create(returnJob);

    const redirectUrl = returnUrl?.startsWith('rydafirst://') ? returnUrl : `${this.env.WEB_APP_URL}/jobs/${returnJob.id}/track`;
    const email = await this.collectionEmail(job.customerId);
    const { txRef, link } = await this.escrow.beginCollection(returnJob.id, Money.of(returnTotal), email, redirectUrl);
    await this.jobs.setPaymentRefs(returnJob.id, { txRef });
    await this.notify.record(job.customerId, {
      title: 'Return started',
      body: unpaidWaiting > 0 ? 'Pay the return + waiting fee to have your package brought back to you.' : 'Pay the return fee to have your package brought back to you.',
      jobId: returnJob.id, urgent: true,
    });
    return { ...returnJob, flwTxRef: txRef, paymentLink: link };
  }

  async failedAttempt(riderId: string, jobId: string): Promise<{ status: JobStatus; attemptFeeMinor: number; waitingFeeMinor: number }> {
    const job = await this.assertAssigned(jobId, riderId);
    assertTransition(job.status, 'FAILED_ATTEMPT');
    await this.transitionTo(jobId, 'FAILED_ATTEMPT');

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
    const res = await this.escrow.settle({
      jobId, status: 'FAILED_ATTEMPT', outcome: 'FAILED_ATTEMPT', collected: Money.of(job.amountMinor), attemptFee: fee,
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
      onPayoutSettled: this.recordPayoutState(jobId),
    });
    await this.notify.record(job.customerId, { title: 'Delivery attempt failed', body: 'The rider couldn’t complete the drop-off. Please check your order for next steps.', jobId, urgent: true });
    return { status: 'FAILED_ATTEMPT', attemptFeeMinor: fee.amount, waitingFeeMinor: feeCalc.waitingMinor };
  }

  /**
   * Status of an already-finished delivery belonging to this rider, or null.
   *
   * Exists so confirmation can be idempotent: a rider whose client timed out mid-confirm (the
   * release is durable but the response never arrived) retries the SAME correct code, and must be
   * told the job is done rather than "invalid code". Returns null unless the caller is the assigned
   * rider AND the job actually completed — the code hash is still verified by the caller, so this
   * widens nothing for someone who doesn't hold the code.
   */
  async completedStatusForRider(riderId: string, jobId: string): Promise<JobStatus | null> {
    const job = await this.jobs.find(jobId);
    if (!job || job.riderId !== riderId) return null;
    return isDeliveryComplete(job.status) ? job.status : null;
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
    // Only the customer gets the rider's number — a rider calling this about their own job would
    // otherwise be handed their own contact details back.
    const contact = actorId === job.customerId ? await this.contactFor(job, actorId, job.riderId) : {};
    return { rider: { ...rider, rating: average, ratingCount: count, ...contact } };
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
    await this.transitionTo(job.id, 'CANCELLED');
    return { ...job, status: 'CANCELLED' };
  }

  async cancel(actorId: string, jobId: string): Promise<{ status: JobStatus; refunded: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    const policy = cancellationPolicy(job.status);
    if (!policy.allowed) throw new ConflictException('Job can no longer be cancelled');
    await this.transitionTo(jobId, 'CANCELLED');
    if (policy.refundFull) {
      const res = await this.escrow.settle({
        jobId, status: 'CANCELLED', outcome: 'REFUND_FULL', collected: Money.of(job.amountMinor),
        ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
        onPayoutSettled: this.recordPayoutState(jobId),
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
    // Idempotent: a second dispute click on an already-disputed (or resolved) job is a no-op,
    // never a 500. Both parties may hit the button; we return the current state instead of erroring.
    if (job.status === 'DISPUTED') return { status: 'DISPUTED' };
    if (job.status === 'DISPUTE_RESOLVED') return { status: 'DISPUTE_RESOLVED' };
    // Post-release / post-cancel: the funds have already settled, so a dispute is a clean 409
    // (ConflictException) with a client-safe message — not an illegal-transition 500.
    if (!canTransition(job.status, 'DISPUTED')) {
      throw new ConflictException('This delivery can no longer be disputed.');
    }
    await this.transitionTo(jobId, 'DISPUTED');
    return { status: 'DISPUTED' };
  }

  async resolveDispute(jobId: string, resolution: Resolution, opts: { riderShareMinor?: number } = {}): Promise<{ status: JobStatus }> {
    const job = await this.mustFind(jobId);
    assertTransition(job.status, 'DISPUTE_RESOLVED');
    await this.transitionTo(jobId, 'DISPUTE_RESOLVED');
    const riderPayout = await this.payout.getPayout(job.riderId ?? '');
    const res = await this.escrow.settle({
      jobId, status: 'DISPUTE_RESOLVED', outcome: resolutionToSettlement(resolution),
      collected: Money.of(job.amountMinor),
      // A dispute resolved in the rider's favour is still a completed delivery — the platform keeps
      // its fee (parity with a normal release). Refund/split outcomes take no fee (money returns).
      ...(resolution === 'RELEASE' ? { platformFee: Money.of(job.platformFeeMinor ?? 0) } : {}),
      ...(opts.riderShareMinor !== undefined ? { riderShare: Money.of(opts.riderShareMinor) } : {}),
      ...(riderPayout ? { riderPayout } : {}),
      ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
      onPayoutSettled: this.recordPayoutState(jobId),
    });
    return { status: 'DISPUTE_RESOLVED' };
  }

  /**
   * Retry a stranded external payout (admin/ops). The ledger release already happened; this only
   * re-attempts the bank transfer / card refund, idempotently (the provider reference is stable, so
   * it can never double-pay). We only auto-retry outcomes whose amounts are fully reconstructible
   * from persisted state (RELEASED → full rider payout minus platform fee; CANCELLED → full refund).
   * Split outcomes (failed-attempt fee, dispute split) are left for manual ops so we never guess an
   * amount and mispay.
   */
  async retryPayout(jobId: string): Promise<{ payoutPending: boolean; payoutError?: string }> {
    const job = await this.mustFind(jobId);
    if (!job.payoutPending) return { payoutPending: false };

    let res: SettleResult;
    if (job.status === 'RELEASED') {
      const riderPayout = job.riderId ? await this.payout.getPayout(job.riderId) : null;
      if (!riderPayout) throw new ConflictException('Rider has no payout account on file; cannot retry.');
      res = await this.escrow.retryDisbursement({
        jobId, status: 'COMPLETED', outcome: 'RELEASE_FULL', collected: Money.of(job.amountMinor),
        platformFee: Money.of(job.platformFeeMinor ?? 0), riderPayout,
      });
    } else if (job.status === 'CANCELLED') {
      if (!job.flwTxId) throw new ConflictException('No collection transaction to refund; cannot retry.');
      res = await this.escrow.retryDisbursement({
        jobId, status: 'CANCELLED', outcome: 'REFUND_FULL', collected: Money.of(job.amountMinor),
        transactionId: job.flwTxId,
      });
    } else {
      throw new ConflictException('This payout needs manual review and cannot be auto-retried.');
    }

    await this.jobs.setPayoutState(jobId, {
      pending: res.payoutPending,
      error: res.payoutError ?? null,
      ref: res.payoutPending ? (job.payoutRef ?? null) : (res.providerRef || null),
    });
    return res.payoutPending ? { payoutPending: true, ...(res.payoutError ? { payoutError: res.payoutError } : {}) } : { payoutPending: false };
  }

  /** Jobs whose rider payout still needs a retry (admin finance queue). */
  async listPendingPayouts(limit = 100): Promise<Job[]> { return this.jobs.listPayoutPending(limit); }

  /** Customer taps "I'm coming" — nudge the assigned rider that they're on their way to meet them. */
  async notifyRiderComing(actorId: string, jobId: string): Promise<{ ok: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId) throw new ForbiddenException();
    if (!job.riderId) throw new ConflictException('No rider is assigned yet');
    // Light rate-limit so the button can't be used to spam the rider.
    const within = await this.limiter.hit(`coming:${jobId}`, 5, 300);
    if (!within) throw new ConflictException('Please wait a moment before notifying your rider again');
    await this.notify.record(job.riderId, {
      title: 'Customer is on the way', body: 'Your customer says they’re coming to meet you.', jobId, urgent: true,
    });
    return { ok: true };
  }

  async listActiveJobs(): Promise<Job[]> { return this.jobs.listActive(); }
  async listRecentJobs(limit = 100): Promise<Job[]> { return this.jobs.listRecent(limit); }
  async jobsForRider(riderId: string): Promise<Job[]> { return this.jobs.listByRider(riderId); }

  async status(jobId: string): Promise<JobStatus> { return (await this.mustFind(jobId)).status; }

  /**
   * The single place a job's status changes.
   *
   * Every transition also appends to the append-only status log, which is what per-stage timings and
   * the inactivity scan are derived from. Routing all 18 call sites through here means a new flow
   * cannot forget to record its history — the alternative was 18 chances to miss one.
   *
   * The log write is best-effort: timing history is valuable, but it is not worth failing a delivery
   * over. A missing event degrades a duration, it does not corrupt the job.
   */
  private async transitionTo(jobId: string, status: JobStatus): Promise<void> {
    await this.jobs.updateStatus(jobId, status);
    try {
      await this.statusLog.append(jobId, status, Date.now());
    } catch (e) {
      this.log.warn(`Status history not recorded for ${jobId} -> ${status}: ${(e as Error).message}`);
    }
  }

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
