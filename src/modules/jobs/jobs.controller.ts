import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { JobsService } from './jobs.service.js';
import { AdvanceDto, ArriveDto, ConfirmPaymentDto, CreateJobDto, QuoteRequestDto } from './dto/jobs.dto.js';

@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

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

  // ---- Rider: discovery feed (declared before :id so "available" isn't read as an id) ----
  @Get('available')
  @RequirePermission('job:accept')
  available() {
    return this.jobs.availableJobs();
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

  // ---- Rider: hand an accepted job back to the pool (before pickup only) ----
  @Post(':id/release')
  @RequirePermission('job:accept')
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.releaseJob(user.id, id);
  }
}
