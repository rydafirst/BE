import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { MarketplaceGuard } from '../settings/marketplace.guard.js';
import { JobTimingsService } from './job-timings.service.js';
import { JobDiscoveryService } from './job-discovery.service.js';
import { JobRatingsService } from './job-ratings.service.js';
import { JobsService } from './jobs.service.js';
import { IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AdvanceDto, ArriveDto, ConfirmPaymentDto, CreateErrandDto, CreateJobDto, CreateMarketplaceOrderDto, ErrandTopUpConfirmDto, ErrandTopUpRequestDto, ErrandTopUpStartDto, QuoteRequestDto, RetryPaymentDto, VendorAccountDto } from './dto/jobs.dto.js';

class RatingDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() @Length(0, 500) comment?: string;
}

class ReturnDto {
  @IsOptional() @IsString() @Length(0, 300) returnUrl?: string;
}

class RiderLocationDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

// #4 MULTI-STOP: the rider confirms an extra drop-off with its recipient's code + a GPS fix at the stop.
class ConfirmStopDto {
  @IsString() @Length(4, 8) code!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
}

@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly timing: JobTimingsService,
    private readonly discovery: JobDiscoveryService,
    private readonly ratings: JobRatingsService,
  ) {}

  // ---- Customer ----
  @Post('quote')
  @RequirePermission('job:create')
  quote(@Body() dto: QuoteRequestDto) {
    return this.jobs.quote(dto);
  }

  @Post()
  @RequirePermission('job:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobDto) {
    return this.jobs.createJob(user.id, dto);
  }

  // ---- Errand ("buy-for-me") ----
  @Post('errand')
  @RequirePermission('job:create')
  createErrand(@CurrentUser() user: AuthUser, @Body() dto: CreateErrandDto) {
    return this.jobs.createErrand(user.id, dto);
  }

  /** MARKETPLACE: check out a cart from a registered vendor (prices read server-side from the catalog). */
  @Post('marketplace')
  @UseGuards(MarketplaceGuard)
  @RequirePermission('job:create')
  createMarketplaceOrder(@CurrentUser() user: AuthUser, @Body() dto: CreateMarketplaceOrderDto) {
    return this.jobs.createMarketplaceOrder(user.id, dto);
  }

  /** MARKETPLACE: the vendor's own incoming orders + payout status (declared before :id). */
  @Get('vendor-orders')
  @UseGuards(MarketplaceGuard)
  @RequirePermission('vendor:manage:own')
  vendorOrders(@CurrentUser() user: AuthUser) {
    return this.jobs.vendorOrders(user.id);
  }

  /** Rider captures the vendor's business account at the store; server resolves + name-matches it. */
  @Post(':id/errand/vendor-account')
  @RequirePermission('job:accept')
  captureVendorAccount(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VendorAccountDto) {
    return this.jobs.captureVendorAccount(user.id, id, dto.bankCode, dto.accountNumber);
  }

  /** Customer approves the resolved vendor account — this releases the goods-money to the vendor. */
  @Post(':id/errand/approve-vendor')
  @RequirePermission('job:read:own')
  approveVendor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.approveVendorAccount(user.id, id);
  }

  /** Receipt proving the shop was paid — shown to the vendor, kept by the customer (either party). */
  @Get(':id/errand/receipt')
  @RequirePermission('job:read:own')
  errandReceipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.errandReceipt(user.id, id);
  }

  /** Rider: the shop price is higher — ask the customer to add more money. */
  @Post(':id/errand/request-topup')
  @RequirePermission('job:accept')
  requestTopUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ErrandTopUpRequestDto) {
    return this.jobs.requestErrandTopUp(user.id, id, dto.additionalMinor);
  }

  /** Customer: start paying the requested top-up (returns the hosted-checkout link). */
  @Post(':id/errand/start-topup')
  @RequirePermission('job:read:own')
  startTopUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ErrandTopUpStartDto) {
    return this.jobs.startErrandTopUp(user.id, id, dto.returnUrl);
  }

  /** Customer: verify the paid top-up and apply it to the goods held for the vendor. */
  @Post(':id/errand/confirm-topup')
  @RequirePermission('job:read:own')
  confirmTopUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ErrandTopUpConfirmDto) {
    return this.jobs.confirmErrandTopUp(user.id, id, dto.transactionId);
  }

  // ---- Customer: order history (declared before :id so "mine" isn't read as an id) ----
  @Get('mine')
  @RequirePermission('job:read:own')
  mine(@CurrentUser() user: AuthUser) {
    return this.jobs.myJobs(user.id);
  }

  // Completed deliveries the customer hasn't rated yet (declared before :id).
  @Get('pending-ratings')
  @RequirePermission('job:read:own')
  pendingRatings(@CurrentUser() user: AuthUser) {
    return this.ratings.pendingRatings(user.id);
  }

  // ---- Rider: discovery feed (declared before :id so "available" isn't read as an id) ----
  // POST (not GET) so the rider's location rides in the request BODY, never in a URL/query string
  // that could be captured in access logs. Body is optional; without it the board is newest-first.
  @Post('available')
  @RequirePermission('job:accept')
  available(@Body() dto: RiderLocationDto) {
    const pos = Number.isFinite(dto.lat) && Number.isFinite(dto.lng) && dto.lat !== undefined && dto.lng !== undefined
      ? { lat: dto.lat, lng: dto.lng } : undefined;
    return this.discovery.availableJobs(pos);
  }

  // ---- Rider: jobs assigned to me (so an active trip is resumable from any device) ----
  @Get('assigned')
  @RequirePermission('job:accept')
  assigned(@CurrentUser() user: AuthUser) {
    return this.jobs.jobsForRider(user.id);
  }

  @Get(':id')
  @RequirePermission('job:read:own')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.getJob(user.id, id);
  }

  /** Per-stage durations for this delivery (party-only). Powers the rider's stage timers. */
  @Get(':id/timings')
  @RequirePermission('job:read:own')
  timings(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.timing.forJob(user.id, id);
  }

  @Get(':id/rider')
  @RequirePermission('job:read:own')
  riderSummary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.assignedRiderSummary(user.id, id);
  }

  @Get(':id/customer')
  @RequirePermission('job:accept')
  customerSummary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.assignedCustomerSummary(user.id, id);
  }

  @Post(':id/rating')
  @RequirePermission('job:read:own')
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RatingDto) {
    return this.ratings.rateJob(user.id, id, dto);
  }

  @Post(':id/confirm-payment')
  @RequirePermission('job:read:own')
  confirmPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    return this.jobs.confirmPayment(user.id, id, dto.transactionId);
  }

  @Post(':id/retry-payment')
  @RequirePermission('job:read:own')
  retryPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RetryPaymentDto) {
    return this.jobs.retryPayment(user.id, id, dto.returnUrl);
  }

  @Post(':id/cancel')
  @RequirePermission('job:read:own')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.cancel(user.id, id);
  }

  @Post(':id/coming')
  @RequirePermission('job:read:own')
  notifyComing(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.notifyRiderComing(user.id, id);
  }

  // ---- Rider ----
  @Post(':id/accept')
  @RequirePermission('job:accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.accept(user.id, id);
  }

  @Post(':id/advance')
  @RequirePermission('job:accept')
  advance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdvanceDto) {
    return this.jobs.advance(user.id, id, dto.to);
  }

  @Post(':id/arrive-pickup')
  @RequirePermission('job:accept')
  arrivePickup(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ArriveDto) {
    return this.jobs.arriveAtPickup(user.id, id, { lat: dto.lat, lng: dto.lng }, dto.accuracyM);
  }

  @Post(':id/arrive')
  @RequirePermission('job:accept')
  arrive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ArriveDto) {
    return this.jobs.markArrived(user.id, id, { lat: dto.lat, lng: dto.lng }, dto.accuracyM);
  }

  @Post(':id/failed-attempt')
  @RequirePermission('job:accept')
  failedAttempt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.failedAttempt(user.id, id);
  }

  // ---- Rider: multi-stop — confirm an EXTRA drop-off (index is 0-based within extraStops) ----
  // The primary drop-off still uses POST :id/confirm-code; extra stops are confirmed in order after it,
  // and only the FINAL stop's confirmation releases escrow to the rider.
  @Post(':id/stops/:index/confirm-code')
  @RequirePermission('job:accept')
  confirmStop(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ConfirmStopDto,
  ) {
    return this.jobs.confirmStop(user.id, id, index, dto.code, { lat: dto.lat, lng: dto.lng }, dto.accuracyM);
  }

  // #4 MULTI-STOP: the booking CUSTOMER re-reveals an extra stop's confirmation code (mints a fresh one),
  // so they never have to screenshot the codes at booking. `index` is 0-based within extraStops.
  @Post(':id/stops/:index/code')
  @RequirePermission('job:read:own')
  issueStopCode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.jobs.issueStopCode(user.id, id, index);
  }

  // ---- Rider: recipient unavailable — start the free 10-min wait, then escalate for resolution ----
  @Post(':id/start-waiting')
  @RequirePermission('job:accept')
  startWaiting(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.startWaiting(user.id, id);
  }

  @Post(':id/escalate')
  @RequirePermission('job:accept')
  escalate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.escalateResolution(user.id, id);
  }

  @Post(':id/charge-waiting')
  @RequirePermission('job:accept')
  chargeWaiting(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.chargeWaiting(user.id, id);
  }

  @Post(':id/confirm-waiting-payment')
  @RequirePermission('job:read:own')
  confirmWaitingPayment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmPaymentDto) {
    return this.jobs.confirmWaitingPayment(user.id, id, dto.transactionId);
  }

  // ---- Customer: resolve a stalled delivery (keep the rider waiting, or return to sender) ----
  @Post(':id/keep-waiting')
  @RequirePermission('job:read:own')
  keepWaiting(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.keepWaiting(user.id, id);
  }

  @Post(':id/pay-waiting')
  @RequirePermission('job:read:own')
  payWaiting(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.payWaiting(user.id, id);
  }

  @Post(':id/return')
  @RequirePermission('job:read:own')
  initiateReturn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReturnDto) {
    return this.jobs.initiateReturn(user.id, id, dto.returnUrl);
  }

  // ---- Rider: hand an accepted job back to the pool (before pickup only) ----
  @Post(':id/release')
  @RequirePermission('job:accept')
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.releaseJob(user.id, id);
  }
}
