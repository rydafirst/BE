import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { AdminOpsService } from './admin-ops.service.js';
import { RiderKycService } from '../riders/rider-kyc.service.js';
import { SettingsService, type LaunchCity } from '../settings/settings.service.js';
import { ALL_TRACKS, toggleableCatalog } from '../documents/domain/document-catalog.js';

class KycDecisionDto {
  @IsBoolean() approve!: boolean;
}

class AssignDto {
  @IsString() @Length(1, 64) riderId!: string;
}

class SettingsDto {
  @IsOptional() @IsBoolean() requireGuarantor?: boolean;
  @IsOptional() @IsBoolean() enforceRiderClearance?: boolean;
  @IsOptional() @IsBoolean() marketplaceEnabled?: boolean;
  @IsOptional() @IsBoolean() lateMoneyPenaltyEnabled?: boolean;
  @IsOptional() @IsIn(['LAGOS', 'ABUJA', 'PORT_HARCOURT', 'OTHER']) launchCity?: LaunchCity;
  @IsOptional() @IsInt() @Min(0) referralRewardMinor?: number;
  @IsOptional() @IsBoolean() referralsEnabled?: boolean;
  // Per-vehicle hidden documents: { CAR: ['INSURANCE'], BIKE: [...] }. Identity docs can't be hidden
  // (the catalogue locks them regardless), so no per-type enum check is needed here.
  @IsOptional() @IsObject() disabledDocByTrack?: Record<string, string[]>;
}

@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly kyc: RiderKycService,
    private readonly settings: SettingsService,
  ) {}

  @Get('settings')
  @RequirePermission('admin:settings:manage')
  getSettings() {
    return this.settings.effective();
  }

  @Put('settings')
  @RequirePermission('admin:settings:manage')
  updateSettings(@Body() dto: SettingsDto) {
    return this.settings.update(dto);
  }

  /** The admin-toggleable rider documents and which vehicle tracks each applies to (per-vehicle matrix). */
  @Get('documents/catalog')
  @RequirePermission('admin:settings:manage')
  documentCatalog() {
    return { tracks: ALL_TRACKS, items: toggleableCatalog() };
  }

  @Get('ops/jobs/active')
  @RequirePermission('admin:finance:read')
  activeJobs() {
    return this.ops.activeJobs();
  }

  @Get('ops/deliveries')
  @RequirePermission('admin:finance:read')
  deliveries() {
    return this.ops.deliveries();
  }

  @Get('finance/reconciliation')
  @RequirePermission('admin:finance:read')
  reconciliation() {
    return this.ops.finance();
  }

  // Force-void a stuck / non-functioning delivery so it stops showing as live. Refunds if funded.
  @Post('ops/deliveries/:jobId/void')
  @RequirePermission('admin:finance:manage')
  voidDelivery(@Param('jobId') jobId: string) {
    return this.ops.voidJob(jobId);
  }

  // Manually assign a SEARCHING delivery to a specific rider (bypasses the per-rider active cap).
  @Post('ops/deliveries/:jobId/assign')
  @RequirePermission('admin:finance:manage')
  assignDelivery(@Param('jobId') jobId: string, @Body() dto: AssignDto) {
    return this.ops.assignJob(jobId, dto.riderId);
  }

  @Get('finance/payouts/pending')
  @RequirePermission('admin:finance:read')
  pendingPayouts() {
    return this.ops.pendingPayouts();
  }

  @Post('finance/payouts/:jobId/retry')
  @RequirePermission('admin:finance:manage')
  retryPayout(@Param('jobId') jobId: string, @Query('force') force?: string) {
    // ?force=true re-drives a job even if it isn't flagged pending, so an operator can trigger a
    // specific rider transfer and read back the exact provider error. Idempotent — never double-pays.
    return this.ops.retryPayout(jobId, force === 'true');
  }

  @Get('finance/payouts/:jobId/transfer-status')
  @RequirePermission('admin:finance:read')
  transferStatus(@Param('jobId') jobId: string) {
    return this.ops.transferStatus(jobId);
  }

  @Post('finance/payouts/:jobId/resend')
  @RequirePermission('admin:finance:manage')
  resendPayout(@Param('jobId') jobId: string) {
    return this.ops.resendPayout(jobId);
  }

  @Get('kyc/pending')
  @RequirePermission('admin:kyc:review')
  pendingKyc() {
    return this.kyc.listPending();
  }

  @Post('kyc/:riderId/decision')
  @RequirePermission('admin:kyc:review')
  decideKyc(@Param('riderId') riderId: string, @Body() dto: KycDecisionDto) {
    return this.kyc.decide(riderId, dto.approve);
  }
}
