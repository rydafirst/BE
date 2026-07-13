import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { AdminOpsService } from './admin-ops.service.js';
import { RiderKycService } from '../riders/rider-kyc.service.js';
import { SettingsService, type LaunchCity } from '../settings/settings.service.js';

class KycDecisionDto {
  @IsBoolean() approve!: boolean;
}

class SettingsDto {
  @IsOptional() @IsBoolean() requireGuarantor?: boolean;
  @IsOptional() @IsBoolean() enforceRiderClearance?: boolean;
  @IsOptional() @IsIn(['LAGOS', 'ABUJA', 'PORT_HARCOURT', 'OTHER']) launchCity?: LaunchCity;
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
