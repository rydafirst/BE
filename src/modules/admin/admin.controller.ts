import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { AdminOpsService } from './admin-ops.service.js';
import { RiderKycService } from '../riders/rider-kyc.service.js';

class KycDecisionDto {
  @IsBoolean() approve!: boolean;
}

@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly kyc: RiderKycService,
  ) {}

  @Get('ops/jobs/active')
  @RequirePermission('admin:finance:read')
  activeJobs() {
    return this.ops.activeJobs();
  }

  @Get('finance/reconciliation')
  @RequirePermission('admin:finance:read')
  reconciliation() {
    return this.ops.reconciliation();
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
