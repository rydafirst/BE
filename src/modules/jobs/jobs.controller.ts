import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { JobTimingsService } from './job-timings.service.js';
import { JobDiscoveryService } from './job-discovery.service.js';
import { JobRatingsService } from './job-ratings.service.js';
import { JobsService } from './jobs.service.js';
import { IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AdvanceDto, ArriveDto, ConfirmPaymentDto, CreateJobDto, QuoteRequestDto } from './dto/jobs.dto.js';

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
    return this.jobs.arriveAtPickup(user.id, id, { lat: dto.lat, lng: dto.lng });
  }

  @Post(':id/arrive')
  @RequirePermission('job:accept')
  arrive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ArriveDto) {
    return this.jobs.markArrived(user.id, id, { lat: dto.lat, lng: dto.lng });
  }

  @Post(':id/failed-attempt')
  @RequirePermission('job:accept')
  failedAttempt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.failedAttempt(user.id, id);
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
