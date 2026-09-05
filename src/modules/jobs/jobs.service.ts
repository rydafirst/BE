import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
  Optional, UnauthorizedException,
} from '@nestjs/common';
import { MARKETPLACE_VENDOR_SOURCE, type MarketplaceVendorSource } from './marketplace.port.js';
import { randomUUID } from 'node:crypto';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.validation.js';
import { Money } from '../payments/domain/money.js';
import { EscrowService, type SettleResult } from '../payments/escrow.service.js';
import type { VerifiedTxn } from '../payments/payment-provider.interface.js';
import { assertTransition, canTransition, isDeliveryComplete, isRiderEngaged, type JobStatus } from './domain/job-state-machine.js';
import { computeFare, type FareBreakdown } from './domain/fare.js';
import { haversineMeters, isTripTooShort, MIN_TRIP_METERS, routeDistanceMeters, type GeoPoint } from './domain/geo.js';
import {
  allExtraStopsDelivered, hasExtraStops, MAX_EXTRA_STOPS, nextPendingStopIndex,
  redactExtraStopsForViewer, type ExtraStop,
} from './domain/multi-stop.js';
import { checkArrival } from '../confirmations/domain/geofence.js';
import { checkCode, generateCode, type CodeRecord } from '../confirmations/domain/confirmation-code.js';
import { HmacHasher } from '../../common/security/hmac-hasher.js';
import { signQuote, verifyQuote } from './domain/quote-token.js';
import { cancellationPolicy } from './domain/cancellation.js';
import { canReleaseJob, MAX_RIDER_RELEASES_PER_DAY, RELEASE_WINDOW_SECONDS } from './domain/rider-release.js';
import { failedAttemptFee } from './domain/failed-attempt-fee.js';
import { accruedWaitingMinor, computeReturnFareMinor, graceElapsed } from './domain/resolution.js';
import { decideFunding } from './domain/funding.js';
import { redactRecipientPhoneForRider } from './domain/recipient-visibility.js';
import { expectedDropSeconds, isDropLegStage, latenessTier, pickedUpAt } from './domain/lateness.js';
import { FARE_CONFIG } from './domain/fare.js';
import { isPaymentExpired, canRetryPayment } from './domain/payment-window.js';
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
import { CallSessionService } from '../calls/call-session.service.js';
import { namesMatch } from '../payments/domain/name-match.js';
import type { ErrandDetails } from './domain/errand.js';
import type { QuoteRequestDto, CreateJobDto, CreateErrandDto } from './dto/jobs.dto.js';

const QUOTE_TTL_MS = 900_000; // 15 minutes — long enough to read options + pay without the quote going stale
const PROGRESS_STEPS: readonly JobStatus[] = ['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'];

// #4 MULTI-STOP: `extraStopCodes` carries the plaintext single-use codes for each extra drop-off,
// returned ONLY here to the booking customer (who distributes them to each recipient) — the same DEV/
// push model as the primary delivery code. They are never stored in plaintext or re-exposed on reads.
export type CreatedJob = Job & { paymentLink: string; extraStopCodes?: string[] };
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
    private readonly calls: CallSessionService,
    // #4 MULTI-STOP: peppered hashing for per-stop confirmation codes (same primitive the primary
    // delivery code uses in ConfirmationService). Optional so the few tests/scripts that construct
    // JobsService without a hasher keep working — a hasher is only ever needed by the multi-stop path.
    private readonly hasher: HmacHasher = new HmacHasher(env),
    // Marketplace catalog read-port (bound to VendorsService in the module). Optional so the many
    // tests/scripts that construct JobsService positionally keep working — only the checkout path needs it.
    @Optional() @Inject(MARKETPLACE_VENDOR_SOURCE) private readonly vendorSource?: MarketplaceVendorSource,
  ) {}

  /**
   * #0 DIRECT DELIVERY: true when the platform runs plain, direct trips (the launch default,
   * DELIVERY_MODE='direct'). In this mode the "receiver unavailable" machinery — Wait / Delegate /
   * Return, metered waiting fees, the return-deposit pre-charge and the failed-attempt fee — is OFF;
   * if the receiver isn't around the parties just call/chat. Set DELIVERY_MODE='fallback' to restore
   * the old behaviour. Kept as ONE decision point so the whole feature is a config flip, not a code
   * hunt (SOLID: the policy lives behind this flag + assertFallbackMode, not scattered conditionals).
   */
  private get directMode(): boolean {
    return this.env.DELIVERY_MODE === 'direct';
  }

  /**
   * #0 DIRECT DELIVERY: reject a fallback-only action (waiting fee / return / failed-attempt) while
   * running in direct mode. Returns a clear 409 so the client shows "not available", never a 500, and
   * — critically — no money path is opened: escrow can still ONLY release via the funded, code-verified
   * completeDelivery path.
   */
  private assertFallbackMode(): void {
    if (this.directMode) {
      throw new ConflictException('Not available in direct delivery mode — reach the recipient by call or chat.');
    }
  }

  /** The customer's name + photo for the assigned rider (party-only, after they're on the job). */
  async assignedCustomerSummary(riderId: string, jobId: string): Promise<{ name?: string; photoUrl?: string; phone?: string; phoneMasked?: boolean; callMode?: 'proxy' | 'direct'; callNumber?: string }> {
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
   *
   * `callMode` tells the client how to place the call: 'proxy' (masked in-app calling is live — the
   * client requests a call and the server rings them; NO number is handed out) or 'direct' (fall
   * back to a `tel:` link with the number below).
   */
  private async contactFor(job: Job, callerUserId: string, subjectUserId: string): Promise<{ phone?: string; phoneMasked?: boolean; callMode: 'proxy' | 'direct'; callNumber?: string }> {
    if (!contactAllowed(job.status)) return { callMode: 'direct' };
    // Masked calling on (Pattern A): the client is offered TWO options in the call sheet —
    //  · "In-app call" → dial `callNumber` (the AT masked line); the server bridges, numbers stay private.
    //  · "Call out"    → dial `phone` (the counterparty's real number) from the normal phone dialer.
    // Both are returned only while the delivery is in flight; the server stops returning them once it ends.
    if (this.calls.enabled()) {
      const callNumber = this.calls.maskedDialNumber();
      const contact = await this.contact.numberFor({ jobId: job.id, callerUserId, subjectUserId });
      return {
        callMode: 'proxy',
        ...(callNumber ? { callNumber } : {}),
        ...(contact.number ? { phone: contact.number, phoneMasked: contact.masked } : {}),
      };
    }
    const contact = await this.contact.numberFor({ jobId: job.id, callerUserId, subjectUserId });
    return contact.number ? { phone: contact.number, phoneMasked: contact.masked, callMode: 'direct' } : { callMode: 'direct' };
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
    // Reject a pickup and drop-off at the same spot (e.g. both set via "use my location"). Otherwise
    // the trip prices as zero distance and both "navigate" buttons open the same point — the source of
    // the "drop-off goes to pickup" confusion. Enforced server-side so the client can't bypass it.
    if (isTripTooShort(dto.pickup, dto.dropoff)) {
      throw new BadRequestException(`Pickup and drop-off must be at least ${MIN_TRIP_METERS}m apart — choose two different locations.`);
    }
    // #4 MULTI-STOP: the ordered route is pickup -> dropoff -> extra stops. Reject a zero-length leg
    // (two consecutive points at the same spot) the same way single-stop rejects pickup==dropoff, so a
    // stop can never price as a free leg. Points are normalised to {lat,lng} for a stable signature.
    const stops = (dto.stops ?? []).map((s) => ({ lat: s.lat, lng: s.lng }));
    if (stops.length > MAX_EXTRA_STOPS) throw new BadRequestException(`At most ${MAX_EXTRA_STOPS} extra stops are allowed.`);
    const routePoints: GeoPoint[] = [dto.pickup, dto.dropoff, ...stops];
    for (let i = 1; i < routePoints.length; i++) {
      if (isTripTooShort(routePoints[i - 1]!, routePoints[i]!)) {
        throw new BadRequestException(`Each stop must be at least ${MIN_TRIP_METERS}m from the previous one — choose distinct locations.`);
      }
    }
    // Price the FULL multi-leg route, never a single leg — a 3-drop job costs the whole path.
    const distance = routeDistanceMeters(routePoints);
    const breakdown = computeFare(dto.type, distance);
    const quoteToken = signQuote(
      {
        type: dto.type, amountMinor: breakdown.totalMinor, currency: 'NGN',
        pickup: dto.pickup, dropoff: dto.dropoff,
        // Omit `stops` entirely for a single-stop quote so its signed bytes are unchanged.
        ...(stops.length > 0 ? { stops } : {}),
        exp: Date.now() + QUOTE_TTL_MS,
      },
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
    // #4 MULTI-STOP: recompute over the SIGNED route (pickup -> dropoff -> signed extra stops). The
    // extra points come only from the signed token, never from the createJob body, so a client can't
    // append/move a stop after quoting to under-pay. For a single-stop quote (no signed stops) this is
    // exactly `haversineMeters(pickup, dropoff)` — the single-stop fare is unchanged.
    const signedStops = v.payload.stops ?? [];
    const fare = computeFare(v.payload.type, routeDistanceMeters([v.payload.pickup, v.payload.dropoff, ...signedStops]));
    if (fare.totalMinor !== v.payload.amountMinor) {
      throw new BadRequestException('Quote no longer valid — please refresh your price');
    }
    // The per-stop metadata (recipient/item/…) must line up 1:1 with the signed points, else we can't
    // safely attribute a recipient/code to a stop — reject rather than guess.
    const stopMeta = dto.extraStops ?? [];
    if (stopMeta.length !== signedStops.length) {
      throw new BadRequestException('Stop details do not match the quoted stops — please refresh your price');
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
    //
    // #0 DIRECT DELIVERY: in direct mode NO return deposit is ever pre-charged — the escrow hold is
    // the plain fare only. Any fallbackPolicy the client still sends is accepted but ignored for
    // charging (delegate-style is the default). This is only fallback-mode behaviour.
    const returnReserveMinor = (!this.directMode && dto.fallbackPolicy === 'RETURN')
      ? computeReturnFareMinor(fare.totalMinor)
      : 0;
    const chargeMinor = v.payload.amountMinor + returnReserveMinor;

    // #4 MULTI-STOP: materialise each extra drop-off from its SIGNED point + the customer's metadata,
    // and mint a single-use confirmation code per stop (stored HASHED, exactly like the primary code).
    // The plaintext codes are returned once to the booking customer to hand to each recipient.
    const extraStopCodes: string[] = [];
    const extraStops: ExtraStop[] = signedStops.map((point, i) => {
      const code = generateCode();
      extraStopCodes.push(code);
      const meta = stopMeta[i] ?? {};
      return {
        point: { lat: point.lat, lng: point.lng },
        status: 'PENDING' as const,
        codeHash: this.hasher.hash(code),
        attempts: 0,
        ...(meta.recipient ? { recipient: { name: meta.recipient.name, phone: meta.recipient.phone } } : {}),
        ...(meta.item ? { item: meta.item } : {}),
        ...(meta.instructions ? { instructions: meta.instructions } : {}),
        ...(meta.address ? { address: meta.address } : {}),
        ...(meta.area ? { area: meta.area } : {}),
      };
    });

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
      ...(extraStops.length > 0 ? { extraStops } : {}),
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
    // Never echo the stored code hashes back; hand the customer the plaintext per-stop codes instead.
    const safeJob = redactExtraStopsForViewer({ ...job, flwTxRef: txRef }, false);
    return { ...safeJob, paymentLink: link, ...(extraStopCodes.length > 0 ? { extraStopCodes } : {}) };
  }

  /**
   * ERRAND ("buy-for-me"): create the job + start collection. The trip (store -> customer) is quoted and
   * priced exactly like a delivery; the customer's typed `goodsMinor` is added on top and held in escrow
   * for the VENDOR (paid on the customer's approval at the store — see approveVendorAccount). The rider
   * earns only the delivery fee (releaseFullToRider excludes the goods-money).
   */
  async createErrand(customerId: string, dto: CreateErrandDto): Promise<CreatedJob> {
    const v = verifyQuote(dto.quoteToken, this.env.JOBS_QUOTE_SECRET, Date.now());
    if (!v.ok) throw new BadRequestException(`Invalid quote (${v.reason})`);
    if (v.payload.type !== 'ERRAND') throw new BadRequestException('Not an errand quote — re-quote as an errand');
    const fare = computeFare('ERRAND', routeDistanceMeters([v.payload.pickup, v.payload.dropoff]));
    if (fare.totalMinor !== v.payload.amountMinor) throw new BadRequestException('Quote no longer valid — please refresh your price');
    const goodsMinor = Math.round(dto.goodsMinor);
    if (!Number.isInteger(goodsMinor) || goodsMinor <= 0) throw new BadRequestException('Enter the amount to buy');

    // One unpaid order at a time (same guard as delivery).
    const existing = await this.jobs.listByCustomer(customerId);
    for (const j of existing) {
      const fresh = await this.expireIfStale(j);
      if (fresh.status === 'CREATED') {
        throw new ConflictException({ message: 'You have an order awaiting payment. Please complete or cancel it first.', pendingJobId: fresh.id });
      }
    }

    const errand: ErrandDetails = {
      goodsMinor,
      deliveryFeeMinor: fare.totalMinor, // fixed — top-ups grow only the goods, never the rider's fee
      shoppingList: dto.shoppingList,
      ...(dto.storeName || dto.storeArea || dto.storeAddress
        ? { store: { ...(dto.storeName ? { name: dto.storeName } : {}), ...(dto.storeArea ? { area: dto.storeArea } : {}), ...(dto.storeAddress ? { address: dto.storeAddress } : {}) } }
        : {}),
    };
    const job: Job = {
      id: randomUUID(), type: 'ERRAND', status: 'CREATED', customerId,
      ...(dto.customerName ? { customerName: dto.customerName } : {}),
      amountMinor: fare.totalMinor + goodsMinor, platformFeeMinor: fare.platformFeeMinor,
      currency: 'NGN', refundAccountId: dto.refundAccountId ?? 'source',
      pickup: v.payload.pickup, dropoff: v.payload.dropoff,
      ...(dto.storeAddress ? { pickupAddress: dto.storeAddress } : {}),
      ...(dto.dropoffAddress ? { dropoffAddress: dto.dropoffAddress } : {}),
      ...(dto.storeArea ? { pickupArea: dto.storeArea } : {}),
      ...(dto.dropoffArea ? { dropoffArea: dto.dropoffArea } : {}),
      errand,
      createdAt: new Date().toISOString(),
    };
    await this.jobs.create(job);

    const redirectUrl = dto.returnUrl?.startsWith('rydafirst://') ? dto.returnUrl : `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
    const email = await this.collectionEmail(customerId);
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(job.amountMinor), email, redirectUrl);
    await this.jobs.setPaymentRefs(job.id, { txRef });
    return { ...job, flwTxRef: txRef, paymentLink: link };
  }

  /**
   * MARKETPLACE order: the customer buys listed products from an APPROVED vendor. Prices are read
   * server-side from the catalog (never trusted from the body); the vendor's stored, pre-verified
   * business account is used and pre-approved, so on delivery the vendor is paid automatically (see
   * releaseFullToRider) — the rider only ever earns the delivery fee. Modelled as an ERRAND job so it
   * reuses the whole escrow / tracking / chat / receipt spine.
   */
  async createMarketplaceOrder(customerId: string, dto: {
    vendorId: string; items: { productId: string; quantity: number }[]; quoteToken: string;
    dropoffAddress?: string; dropoffArea?: string; customerName?: string; refundAccountId?: string; returnUrl?: string;
  }): Promise<CreatedJob> {
    if (!this.vendorSource) throw new BadRequestException('Marketplace is not available');
    const vendor = await this.vendorSource.getForOrder(dto.vendorId);
    if (!vendor.account) throw new ConflictException('This vendor cannot accept orders yet');
    if (vendor.shopLat == null || vendor.shopLng == null) throw new ConflictException('This vendor has not set a shop location yet');
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new BadRequestException('Your cart is empty');

    // Authoritative pricing: read each product from the catalog; reject foreign/unavailable items.
    let goodsMinor = 0;
    const lines: string[] = [];
    for (const it of dto.items) {
      const qty = Math.round(it.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new BadRequestException('Invalid item quantity');
      const p = await this.vendorSource.findProduct(it.productId);
      if (!p || p.vendorId !== vendor.id) throw new BadRequestException('One of the items is not from this vendor');
      if (!p.available) throw new ConflictException(`“${p.name}” is no longer available`);
      goodsMinor += p.priceMinor * qty;
      lines.push(`${qty}× ${p.name}`);
    }
    if (goodsMinor <= 0) throw new BadRequestException('Your cart total is empty');

    // The trip is quoted vendor-shop → customer. Bind the quote's pickup to the vendor's real shop
    // location so a client can't quote a cheaper short trip than the goods will actually travel.
    const v = verifyQuote(dto.quoteToken, this.env.JOBS_QUOTE_SECRET, Date.now());
    if (!v.ok) throw new BadRequestException(`Invalid quote (${v.reason})`);
    if (v.payload.type !== 'ERRAND') throw new BadRequestException('Not a delivery quote — re-quote this order');
    if (haversineMeters(v.payload.pickup, { lat: vendor.shopLat, lng: vendor.shopLng }) > 200) {
      throw new BadRequestException('Quote pickup does not match the vendor shop — please refresh');
    }
    const fare = computeFare('ERRAND', routeDistanceMeters([v.payload.pickup, v.payload.dropoff]));
    if (fare.totalMinor !== v.payload.amountMinor) throw new BadRequestException('Quote no longer valid — please refresh your price');

    // One unpaid order at a time (same guard as delivery/errand).
    const existing = await this.jobs.listByCustomer(customerId);
    for (const j of existing) {
      const fresh = await this.expireIfStale(j);
      if (fresh.status === 'CREATED') {
        throw new ConflictException({ message: 'You have an order awaiting payment. Please complete or cancel it first.', pendingJobId: fresh.id });
      }
    }

    const errand: ErrandDetails = {
      goodsMinor,
      deliveryFeeMinor: fare.totalMinor,
      shoppingList: lines.join(', '),
      store: { name: vendor.businessName, ...(vendor.area ? { area: vendor.area } : {}) },
      vendorAccount: vendor.account,
      vendorApproved: true,
      autoVendorPayout: true,
      marketplaceVendorId: vendor.id,
    };
    const job: Job = {
      id: randomUUID(), type: 'ERRAND', status: 'CREATED', customerId,
      ...(dto.customerName ? { customerName: dto.customerName } : {}),
      amountMinor: fare.totalMinor + goodsMinor, platformFeeMinor: fare.platformFeeMinor,
      currency: 'NGN', refundAccountId: dto.refundAccountId ?? 'source',
      pickup: v.payload.pickup, dropoff: v.payload.dropoff,
      ...(dto.dropoffAddress ? { dropoffAddress: dto.dropoffAddress } : {}),
      ...(dto.dropoffArea ? { dropoffArea: dto.dropoffArea } : {}),
      pickupAddress: vendor.businessName,
      ...(vendor.area ? { pickupArea: vendor.area } : {}),
      errand,
      createdAt: new Date().toISOString(),
    };
    await this.jobs.create(job);

    const redirectUrl = dto.returnUrl?.startsWith('rydafirst://') ? dto.returnUrl : `${this.env.WEB_APP_URL}/jobs/${job.id}/track`;
    const email = await this.collectionEmail(customerId);
    const { txRef, link } = await this.escrow.beginCollection(job.id, Money.of(job.amountMinor), email, redirectUrl);
    await this.jobs.setPaymentRefs(job.id, { txRef });
    return { ...job, flwTxRef: txRef, paymentLink: link };
  }

  /**
   * ERRAND: the assigned rider captures the vendor's BUSINESS account at the store. The server resolves
   * the real account name (name enquiry) and scores it against the store name the customer gave — the
   * customer then approves before any money moves. The rider never types the name, and only bankCode +
   * number are trusted from the client. Returns the resolved name + whether it looks like a match.
   */
  async captureVendorAccount(riderId: string, jobId: string, bankCode: string, accountNumber: string): Promise<{ accountName: string; match: boolean }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    const { accountName } = await this.escrow.resolveAccount(bankCode, accountNumber);
    const match = job.errand.store?.name ? namesMatch(job.errand.store.name, accountName) : false;
    await this.jobs.setErrand(jobId, { ...job.errand, vendorAccount: { bankCode, accountNumber, accountName }, vendorApproved: false });
    return { accountName, match };
  }

  /**
   * ERRAND: the CUSTOMER approves the resolved vendor account, which releases the goods-money to that
   * account (via EscrowService.settleVendorPayout — vendor, never rider). Idempotent: the vendor payout
   * de-dupes at the PSP, so a repeated approval never double-pays.
   */
  async approveVendorAccount(customerId: string, jobId: string): Promise<{ paidPending: boolean }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== customerId) throw new ForbiddenException();
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    const errand = job.errand;
    if (!errand.vendorAccount) throw new ConflictException('The rider has not entered the vendor account yet');
    if (errand.vendorPaidAt) return { paidPending: false }; // already paid (idempotent)

    await this.jobs.setErrand(jobId, { ...errand, vendorApproved: true });
    const res = await this.escrow.settleVendorPayout({
      jobId,
      amount: Money.of(errand.goodsMinor),
      vendorAccount: { bankCode: errand.vendorAccount.bankCode, accountNumber: errand.vendorAccount.accountNumber },
      onPayoutSettled: async (r) => {
        const cur = (await this.jobs.find(jobId))?.errand ?? errand;
        await this.jobs.setErrand(jobId, {
          ...cur, vendorApproved: true,
          ...(r.transferRef ? { vendorPayoutRef: r.transferRef } : {}),
          ...(!r.payoutPending ? { vendorPaidAt: Date.now() } : {}),
        });
      },
    });
    return { paidPending: res.payoutPending };
  }

  /** MARKETPLACE: the vendor's own incoming orders + payout status (owner-scoped, never leaks other data). */
  async vendorOrders(ownerUserId: string): Promise<Array<{
    id: string; status: JobStatus; createdAt: string; goodsMinor: number; deliveryFeeMinor: number;
    items: string; customerName?: string; vendorPaidAt?: number; vendorPayoutRef?: string;
  }>> {
    if (!this.vendorSource) return [];
    const vendorId = await this.vendorSource.findVendorIdByOwner(ownerUserId);
    if (!vendorId) return [];
    const jobs = await this.jobs.listByMarketplaceVendor(vendorId, 100);
    return jobs
      .filter((j) => j.status !== 'CREATED') // hide unpaid/abandoned orders
      .map((j) => ({
        id: j.id, status: j.status as JobStatus, createdAt: j.createdAt,
        goodsMinor: j.errand?.goodsMinor ?? 0,
        deliveryFeeMinor: j.errand?.deliveryFeeMinor ?? 0,
        items: j.errand?.shoppingList ?? '',
        ...(j.customerName ? { customerName: j.customerName } : {}),
        ...(j.errand?.vendorPaidAt ? { vendorPaidAt: j.errand.vendorPaidAt } : {}),
        ...(j.errand?.vendorPayoutRef ? { vendorPayoutRef: j.errand.vendorPayoutRef } : {}),
      }));
  }

  /**
   * ERRAND: a receipt the rider can show the vendor (and the customer keeps) as proof the shop was paid.
   * Amounts and the payout reference are read from the authoritative job/errand record — never the client.
   * Visible to the order's customer or its assigned rider only, and only once the vendor has been paid.
   */
  async errandReceipt(actorId: string, jobId: string): Promise<{
    receiptNo: string; orderId: string; paidAt: number; amountMinor: number; currency: 'NGN';
    vendorName: string; vendorAccountMasked: string; payoutRef?: string; store?: string; shoppingList: string;
  }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== actorId && job.riderId !== actorId) throw new ForbiddenException();
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    const e = job.errand;
    if (!e.vendorPaidAt || !e.vendorAccount) throw new ConflictException('The shop has not been paid yet');
    const acct = e.vendorAccount.accountNumber;
    const masked = acct.length > 4 ? `${'•'.repeat(Math.max(0, acct.length - 4))}${acct.slice(-4)}` : acct;
    return {
      receiptNo: `RYDA-${job.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`,
      orderId: job.id,
      paidAt: e.vendorPaidAt,
      amountMinor: e.goodsMinor,
      currency: 'NGN',
      vendorName: e.vendorAccount.accountName,
      vendorAccountMasked: masked,
      ...(e.vendorPayoutRef ? { payoutRef: e.vendorPayoutRef } : {}),
      ...(e.store?.name ? { store: e.store.name } : {}),
      shoppingList: e.shoppingList,
    };
  }

  /** ERRAND: the rider flags the shop price is higher — asks the customer to add `additionalMinor`. */
  async requestErrandTopUp(riderId: string, jobId: string, additionalMinor: number): Promise<{ requestedTopUpMinor: number }> {
    const job = await this.assertAssigned(jobId, riderId);
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    if (job.errand.vendorPaidAt) throw new ConflictException('The shop has already been paid');
    const add = Math.round(additionalMinor);
    if (!Number.isInteger(add) || add <= 0 || add > 100_000_000) throw new BadRequestException('Enter a valid top-up amount');
    await this.jobs.setErrand(jobId, { ...job.errand, requestedTopUpMinor: add });
    await this.notify.record(job.customerId, {
      title: 'Your rider needs a bit more',
      body: `The items cost more than expected — open the app to add ₦${(add / 100).toLocaleString('en-NG')} so your rider can pay the shop.`,
      jobId, urgent: true,
    });
    return { requestedTopUpMinor: add };
  }

  /** ERRAND: the customer starts paying the requested top-up; returns the hosted-checkout link. */
  async startErrandTopUp(customerId: string, jobId: string, returnUrl?: string): Promise<{ paymentLink: string; amountMinor: number }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== customerId) throw new ForbiddenException();
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    if (job.errand.vendorPaidAt) throw new ConflictException('The shop has already been paid');
    const add = job.errand.requestedTopUpMinor ?? 0;
    if (add <= 0) throw new ConflictException('No top-up has been requested');
    const email = await this.collectionEmail(customerId);
    const redirect = returnUrl?.startsWith('rydafirst://') ? returnUrl : `${this.env.WEB_APP_URL}/jobs/${jobId}/track`;
    const { txRef, link } = await this.escrow.beginCollection(jobId, Money.of(add), email, redirect);
    await this.jobs.setErrand(jobId, { ...job.errand, topUpTxRef: txRef });
    return { paymentLink: link, amountMinor: add };
  }

  /** ERRAND: verify a paid top-up and apply it — adds the extra to the goods (held for the vendor). */
  async confirmErrandTopUp(customerId: string, jobId: string, transactionId: string): Promise<{ funded: boolean; goodsMinor: number }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== customerId) throw new ForbiddenException();
    if (job.type !== 'ERRAND' || !job.errand) throw new ConflictException('This delivery is not an errand');
    const errand = job.errand;
    if (!errand.topUpTxRef) return { funded: false, goodsMinor: errand.goodsMinor };
    if (errand.topUpTxId) return { funded: true, goodsMinor: errand.goodsMinor }; // already applied (idempotent)
    const verified = await this.escrow.verifyTransaction(transactionId);
    if (verified.status !== 'successful') return { funded: false, goodsMinor: errand.goodsMinor };
    if (verified.txRef !== errand.topUpTxRef) throw new BadRequestException('This payment is not for this top-up');
    await this.escrow.confirmTopUpFunding(jobId, verified, verified.txRef);
    await this.jobs.setErrand(jobId, {
      ...errand, goodsMinor: errand.goodsMinor + verified.amountMinor, topUpTxId: verified.transactionId,
      requestedTopUpMinor: 0, topUpTxRef: undefined,
    });
    return { funded: true, goodsMinor: errand.goodsMinor + verified.amountMinor };
  }

  /**
   * Re-issue a checkout link for an order the customer started but didn't finish paying — WITHOUT
   * recreating the trip, so their details are reused. Double-charge safe: stale orders are expired
   * first, then we re-issue ONLY while the order is still CREATED (unfunded on our side). If the first
   * payment actually landed, the webhook has already moved it to FUNDED, so this refuses and returns
   * the current status instead of charging again.
   */
  async retryPayment(customerId: string, jobId: string, returnUrl?: string): Promise<{ status: JobStatus; paymentLink?: string; flwTxRef?: string }> {
    const job = await this.getJob(customerId, jobId); // owner/party check (throws if not theirs)
    const fresh = await this.expireIfStale(job);      // past the window -> CANCELLED, never re-charged
    if (!canRetryPayment(fresh.status)) return { status: fresh.status };
    const redirectUrl = returnUrl?.startsWith('rydafirst://')
      ? returnUrl
      : `${this.env.WEB_APP_URL}/jobs/${fresh.id}/track`;
    const email = await this.collectionEmail(customerId);
    const { txRef, link } = await this.escrow.beginCollection(fresh.id, Money.of(fresh.amountMinor), email, redirectUrl);
    await this.jobs.setPaymentRefs(fresh.id, { txRef });
    return { status: 'CREATED', paymentLink: link, flwTxRef: txRef };
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
    // An errand top-up rides on its own txRef: fund the extra goods-money, not a new fare.
    if (job.type === 'ERRAND' && job.errand?.topUpTxRef === verified.txRef) {
      if (!job.errand.topUpTxId) {
        await this.escrow.confirmTopUpFunding(job.id, verified, verified.txRef);
        await this.jobs.setErrand(job.id, {
          ...job.errand, goodsMinor: job.errand.goodsMinor + verified.amountMinor,
          topUpTxId: verified.transactionId, requestedTopUpMinor: 0, topUpTxRef: undefined,
        });
        if (job.riderId) {
          await this.notify.record(job.riderId, { title: 'Top-up paid', body: 'The customer added the extra money — you can pay the shop now.', jobId: job.id, urgent: true });
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
    // Single active delivery per rider: they must finish or release the job they're on before taking
    // another. Stops a rider hoarding offers they can't run, and keeps the "resume your active trip"
    // routing unambiguous (there is at most one). Checked before the claim so we never assign a second
    // job. (A rider double-tapping two different offers in the same instant is caught by the atomic
    // claim + this guard; the worst residual case is surfaced in admin, never silent.)
    const mine = await this.jobs.listByRider(riderId);
    if (mine.some((j) => isRiderEngaged(j.status))) {
      throw new ConflictException('Finish or release your current delivery before accepting another');
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
  async arriveAtPickup(riderId: string, jobId: string, riderPos: GeoPoint, accuracyMeters = 0): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    // Idempotent: a lost response leaves the app showing the button while the server already advanced,
    // so a re-tap must return success, not a 409 "AT_PICKUP -> AT_PICKUP". The geofence was already
    // verified on the transition that first set this state, so re-confirming is safe.
    if (job.status === 'AT_PICKUP') return job;
    assertTransition(job.status, 'AT_PICKUP');
    const atPickup = checkArrival(riderPos, job.pickup, this.env.ARRIVAL_RADIUS_M, accuracyMeters);
    if (!atPickup.ok) {
      throw new BadRequestException(
        `You appear to be ${atPickup.distanceMeters}m from the pickup (within ${atPickup.allowedMeters}m required). Move closer or wait for a better GPS signal, then try again.`,
      );
    }
    await this.transitionTo(jobId, 'AT_PICKUP');
    // Persistent alert: the rider is at the door to collect — the sender must come out. This is the
    // exact moment a forgetful customer keeps a rider waiting, so it keeps ringing (bounded, client
    // side) until they open the app.
    await this.notify.record(job.customerId, {
      title: 'Your rider is here for pickup',
      body: 'Your rider has arrived to collect the package. Please come out to hand it over.',
      jobId, urgent: true, alertLevel: 'persistent',
    });
    return this.mustFind(jobId);
  }

  async markArrived(riderId: string, jobId: string, riderPos: GeoPoint, accuracyMeters = 0): Promise<Job> {
    const job = await this.assertAssigned(jobId, riderId);
    // Idempotent: same reason as arriveAtPickup — a re-tap after a dropped response (or a stale UI)
    // must succeed instead of throwing "ARRIVED -> ARRIVED" (409), which is the flood in the logs and
    // why the rider saw no feedback and kept pressing. Already at/past arrival means the geofence
    // already passed once; just return the current job.
    if (['ARRIVED', 'AWAITING_CODE', 'WAITING', 'AWAITING_RESOLUTION'].includes(job.status)) return job;
    assertTransition(job.status, 'ARRIVED');
    const atDrop = checkArrival(riderPos, job.dropoff, this.env.ARRIVAL_RADIUS_M, accuracyMeters);
    if (!atDrop.ok) {
      throw new BadRequestException(
        `You appear to be ${atDrop.distanceMeters}m from the drop-off (within ${atDrop.allowedMeters}m required). Move closer or wait for a better GPS signal, then try again.`,
      );
    }
    await this.transitionTo(jobId, 'ARRIVED');
    await this.jobs.setArrivedAt(jobId, Date.now()); // start the waiting clock for WAIT-policy metering
    // Persistent alert: the rider is at the drop-off — the recipient must come out with the code.
    // Same rationale as pickup arrival; rings until the customer opens the app (bounded client-side).
    await this.notify.record(job.customerId, {
      title: 'Your rider has arrived',
      body: 'Your rider is at the drop-off. Please come out, or send the recipient with the delivery code.',
      jobId, urgent: true, alertLevel: 'persistent',
    });
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
    // #4 MULTI-STOP: on a job with extra drop-offs, confirming the PRIMARY code delivers stop #1 only.
    // It moves the job to EN_ROUTE_STOP and records the primary delivery, but MUST NOT release escrow
    // while any extra stop is still pending — the rider is paid once, after the FINAL stop (confirmStop).
    if (hasExtraStops(job)) {
      // Idempotent: if the primary was already delivered (re-tap / lost response), just report state.
      if (job.primaryStopDeliveredAt != null || job.status === 'EN_ROUTE_STOP') {
        return { status: job.status };
      }
      assertTransition(job.status, 'EN_ROUTE_STOP');
      await this.jobs.setPrimaryStopDelivered(job.id, Date.now());
      await this.transitionTo(job.id, 'EN_ROUTE_STOP');
      const remaining = job.extraStops!.length;
      await this.notify.record(job.customerId, {
        title: 'First stop delivered',
        body: `Your first drop-off is complete. ${remaining} more stop${remaining === 1 ? '' : 's'} to go.`,
        jobId: job.id,
      });
      return { status: 'EN_ROUTE_STOP' };
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
   * #4 MULTI-STOP: the rider confirms an EXTRA drop-off by its recipient's own single-use code.
   *
   * Mirrors the primary delivery-code contract (peppered hash, attempt cap, single-use, opaque
   * "Invalid code" on every failure — no enumeration) AND adds a GPS geofence at the stop, mirroring
   * markArrived. Money-safety is the whole point of the ordering here:
   *   - the primary drop-off must be delivered first, then extra stops strictly in order;
   *   - each intermediate stop only flips its own PENDING->DELIVERED flag (NO escrow movement);
   *   - only the FINAL stop's confirmation calls releaseFullToRider, which is idempotent in
   *     escrow.settle — so the rider is paid fare-minus-fee EXACTLY ONCE, never per stop, never twice.
   *
   * `index` is 0-based within `extraStops` (extra stop #1 = index 0), confirmed after the primary.
   */
  async confirmStop(riderId: string, jobId: string, index: number, code: string, riderPos: GeoPoint, accuracyMeters = 0): Promise<{ status: JobStatus }> {
    const job = await this.assertAssigned(jobId, riderId);
    const stops = job.extraStops ?? [];
    const stop = stops[index];
    if (!stop) throw new UnauthorizedException('Invalid code'); // never reveal how many/which stops exist

    // Extra stops come AFTER the primary drop-off. Reject confirming one before the primary is done —
    // unless it's already delivered (a harmless idempotent replay, handled by the code check below).
    if (stop.status !== 'DELIVERED' && job.primaryStopDeliveredAt == null) {
      throw new ConflictException('Confirm the first drop-off before the extra stops');
    }

    const matches = this.hasher.verify(code, stop.codeHash ?? '');
    // A CodeRecord view for the shared checker. createdAtMs=now disables the primary code's 1-hour TTL:
    // an extra stop's code must last the whole (possibly multi-hour) route, so it's protected by the
    // attempt cap + single-use + geofence + assigned-rider gates, not by a booking-time expiry.
    const record: CodeRecord = {
      kind: 'DELIVERY', codeHash: stop.codeHash ?? '', createdAtMs: Date.now(),
      attempts: stop.attempts ?? 0, consumed: stop.status === 'DELIVERED',
    };
    const res = checkCode(record, matches, Date.now());
    if (!res.ok) {
      // Idempotent retry: the confirm (and any final release) is durable but the response can be lost.
      // Re-submitting the SAME correct code on an already-delivered stop reports status, not an error.
      if (res.reason === 'already_used' && matches) return { status: job.status };
      // Count every wrong guess so a stop code can't become an unmetered guessing oracle.
      if (!matches) await this.jobs.incrementExtraStopAttempts(jobId, index);
      throw new UnauthorizedException('Invalid code');
    }

    // Strict order: this must be the NEXT pending stop — you can't skip an earlier undelivered one.
    if (nextPendingStopIndex(stops) !== index) {
      throw new ConflictException('Deliver the earlier stop first');
    }

    // Geofence: the rider must physically be at this stop (mirrors markArrived for the primary drop-off).
    const at = checkArrival(riderPos, stop.point, this.env.ARRIVAL_RADIUS_M, accuracyMeters);
    if (!at.ok) {
      throw new BadRequestException(
        `You appear to be ${at.distanceMeters}m from this stop (within ${at.allowedMeters}m required). Move closer or wait for a better GPS signal, then try again.`,
      );
    }

    await this.jobs.markExtraStopDelivered(jobId, index, Date.now());
    const updated = await this.mustFind(jobId);

    if (allExtraStopsDelivered(updated.extraStops)) {
      // FINAL stop delivered — release escrow ONCE (fare-minus-fee), idempotent + durable via settle.
      await this.releaseFullToRider(updated, riderId);
      await this.notify.record(job.customerId, {
        title: 'All stops delivered',
        body: 'Every drop-off on your multi-stop delivery is complete. Thanks for riding with Rydafirst.',
        jobId,
      });
      return { status: 'RELEASED' };
    }
    const left = (updated.extraStops ?? []).filter((s) => s.status === 'PENDING').length;
    await this.notify.record(job.customerId, {
      title: 'Stop delivered',
      body: `A drop-off is complete. ${left} more stop${left === 1 ? '' : 's'} to go.`,
      jobId,
    });
    return { status: 'EN_ROUTE_STOP' };
  }

  /**
   * #4 MULTI-STOP: (re-)reveal an extra stop's confirmation code to the booking customer.
   *
   * Extra-stop codes are stored HASHED, so — exactly like the primary drop-off's "Reveal code" — we mint
   * a FRESH code, save its hash on the stop, and hand back the plaintext. This removes the "screenshot the
   * codes at booking or you can never see them again" trap: the customer can reveal each stop's current
   * code on the tracking page whenever they reach that stop. `index` is 0-based within extraStops (extra
   * stop #1 = index 0, i.e. the delivery's stop #2 overall).
   */
  async issueStopCode(customerId: string, jobId: string, index: number): Promise<{ code: string }> {
    const job = await this.mustFind(jobId);
    if (job.customerId !== customerId) throw new ForbiddenException();
    const stop = (job.extraStops ?? [])[index];
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.status === 'DELIVERED') throw new ConflictException('This stop has already been delivered');
    const code = generateCode();
    await this.jobs.setExtraStopCode(jobId, index, this.hasher.hash(code));
    return { code };
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
    // the caller (refunded on delivery, or paid to the rider on an actual return). For an ERRAND, the
    // goods-money belongs to the VENDOR (paid separately on customer approval) — never the rider — so
    // it is excluded here too: the rider earns only the delivery fee.
    // For an ERRAND the rider earns the FIXED delivery fee (stored at creation) — decoupled from the
    // goods so in-app top-ups grow only the vendor's amount, never the rider's. Falls back to the
    // (amount − goods) form for any legacy errand created before the fee was stored.
    const fareMinor = job.errand
      ? (job.errand.deliveryFeeMinor ?? (job.amountMinor - job.errand.goodsMinor))
      : job.amountMinor - (job.returnReserveMinor ?? 0);

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
    // MARKETPLACE order: the vendor account is pre-verified + pre-approved (no rider capture / customer
    // approval step), so the vendor is paid the goods-money automatically on delivery confirmation.
    // Idempotent via settleVendorPayout's stable ref, so a retried completion never double-pays.
    const errand = job.errand;
    if (errand?.autoVendorPayout && errand.vendorAccount && !errand.vendorPaidAt && errand.goodsMinor > 0) {
      const vendorAccount = errand.vendorAccount;
      await this.escrow.settleVendorPayout({
        jobId: job.id, amount: Money.of(errand.goodsMinor),
        vendorAccount: { bankCode: vendorAccount.bankCode, accountNumber: vendorAccount.accountNumber },
        onPayoutSettled: async (r) => {
          const cur = (await this.jobs.find(job.id))?.errand ?? errand;
          await this.jobs.setErrand(job.id, {
            ...cur,
            ...(r.transferRef ? { vendorPayoutRef: r.transferRef } : {}),
            ...(!r.payoutPending ? { vendorPaidAt: Date.now() } : {}),
          });
        },
      });
    }
    return res;
  }

  /**
   * Rider raises the metered waiting fee once the free grace has passed. Charges the SENDER a
   * separate collection (never carved from the fare); the rider may only hand over once it's paid.
   */
  async chargeWaiting(riderId: string, jobId: string): Promise<{ waitingFeeMinor: number; paymentLink: string; flwTxRef: string }> {
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no waiting fee in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no waiting fee in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no waiting fee to confirm in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: the wait timer does not exist in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no keep-waiting/return resolution in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no keep-waiting resolution in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no return-to-sender leg in direct mode
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
    this.assertFallbackMode(); // #0 DIRECT DELIVERY: no failed-attempt fee in direct mode
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
    const fresh = await this.expireIfStale(job);
    // Field-level authz: withhold the recipient's phone from the rider until pickup (IN_PROGRESS+), and
    // strip internal per-stop code hashes from everyone + downstream recipients' phones from the rider.
    const viewerIsRider = actorId === fresh.riderId;
    return redactExtraStopsForViewer(redactRecipientPhoneForRider(fresh, viewerIsRider), viewerIsRider);
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
    // Customer view: their own recipient contacts stay, but never expose the internal per-stop hashes.
    for (const j of jobs) out.push(redactExtraStopsForViewer(await this.expireIfStale(j), false));
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
    // The order is CANCELLED the moment the line above commits, so the customer's cancel can return
    // immediately. The refund (a payment-provider round-trip) runs in the BACKGROUND — it used to be
    // awaited here, which is why cancelling felt slow. escrow.settle is idempotent and there's a
    // retryPayout path, so a slow/failed provider call is safe to re-drive rather than block the UI.
    if (policy.refundFull) {
      void this.escrow.settle({
        jobId, status: 'CANCELLED', outcome: 'REFUND_FULL', collected: Money.of(job.amountMinor),
        ...(job.flwTxId ? { transactionId: job.flwTxId } : {}),
        onPayoutSettled: this.recordPayoutState(jobId),
      }).catch((e) => this.log.error(`cancel refund settle failed for ${jobId} — will need retryPayout: ${(e as Error).message}`));
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
  async retryPayout(jobId: string, force = false): Promise<{ payoutPending: boolean; payoutError?: string }> {
    const job = await this.mustFind(jobId);
    // Normally we only touch jobs already flagged pending. `force` lets an operator re-drive a specific
    // job on demand (e.g. to see the exact provider error) even if it isn't flagged — safe because the
    // disbursement reuses the stable provider reference, so a leg that already succeeded is skipped and
    // can never double-pay.
    if (!force && !job.payoutPending) return { payoutPending: false };

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

  /**
   * Real, on-demand transfer status for a job's rider payout, read straight from the processor. A
   * transfer that our side recorded as "accepted" can still be NEW/PENDING or later FAILED at the PSP
   * (transfers are async) — this surfaces that truth to ops without needing the provider dashboard.
   */
  async payoutTransferStatus(jobId: string): Promise<{ jobId: string; payoutRef?: string; status: string; reason?: string }> {
    const job = await this.mustFind(jobId);
    if (!job.payoutRef) {
      return { jobId, status: 'NO_TRANSFER', reason: 'No payout reference recorded for this job yet.' };
    }
    const s = await this.escrow.transferStatus(job.payoutRef);
    return { jobId, payoutRef: job.payoutRef, status: s.status, ...(s.reason ? { reason: s.reason } : {}) };
  }

  /**
   * Re-send a rider payout whose transfer FAILED at the processor (e.g. the payout balance was short
   * when it first ran). Safe: escrow re-checks the real status and only re-sends a confirmed-failed
   * transfer, for the exact failed amount. On success the job's payout state is updated to the new ref.
   */
  async resendFailedPayout(jobId: string): Promise<{ outcome: string; providerStatus: string; amountMinor?: number }> {
    const job = await this.mustFind(jobId);
    if (!job.payoutRef) throw new ConflictException('No transfer on record for this job to re-send.');
    const riderPayout = job.riderId ? await this.payout.getPayout(job.riderId) : null;
    if (!riderPayout) throw new ConflictException('Rider has no payout account on file.');
    const res = await this.escrow.resendFailedTransfer({ jobId, riderPayout, currentRef: job.payoutRef });
    if (res.outcome === 'RESENT' && res.newRef) {
      await this.jobs.setPayoutState(jobId, { pending: false, error: null, ref: res.newRef });
    }
    return { outcome: res.outcome, providerStatus: res.providerStatus, ...(res.amountMinor ? { amountMinor: res.amountMinor } : {}) };
  }

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

  async listActiveJobs(): Promise<Job[]> {
    return (await this.jobs.listActive()).map((j) => redactExtraStopsForViewer(j, false));
  }

  /**
   * Active jobs, each flagged `late` when its drop leg has passed the escalation threshold (2x ETA).
   * This is the ops side of late-detection: the admin console reads it (pull), computing lateness live
   * from the same pure `lateness` domain the push monitor uses — no separate ops push channel exists.
   * Only drop-leg jobs read the status log, so the extra work is bounded to jobs that could be late.
   */
  async listActiveJobsWithLateness(nowMs = Date.now()): Promise<Array<Job & { late: boolean }>> {
    const jobs = (await this.jobs.listActive()).map((j) => redactExtraStopsForViewer(j, false));
    return Promise.all(jobs.map(async (j) => {
      if (!isDropLegStage(j.status)) return { ...j, late: false };
      const events = await this.statusLog.list(j.id);
      const pickup = pickedUpAt(events);
      if (pickup === undefined) return { ...j, late: false };
      const tier = latenessTier({ expectedSec: expectedDropSeconds(j.pickup, j.dropoff), elapsedSec: (nowMs - pickup) / 1000 });
      return { ...j, late: tier === 'all' };
    }));
  }
  async listRecentJobs(limit = 100): Promise<Job[]> {
    return (await this.jobs.listRecent(limit)).map((j) => redactExtraStopsForViewer(j, false));
  }
  async jobsForRider(riderId: string): Promise<Job[]> {
    // Rider view: strip per-stop code hashes, and downstream recipients' phones until pickup.
    return (await this.jobs.listByRider(riderId)).map((j) => redactExtraStopsForViewer(j, true));
  }

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
