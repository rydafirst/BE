import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { ReliabilityService } from './reliability.service.js';

class ManualStrikeDto {
  @IsOptional() @IsString() @Length(1, 64) jobId?: string;
  @IsOptional() @IsString() @Length(1, 200) reason?: string;
}

// Admin adjudication of rider lateness. Gated by the dispute-resolution scope (it's a rider/customer
// judgement call, same class of decision as a delivery dispute).
@Controller({ path: 'admin/reliability', version: '1' })
export class ReliabilityAdminController {
  constructor(private readonly reliability: ReliabilityService) {}

  @Get('reports')
  @RequirePermission('admin:dispute:resolve')
  pending() {
    return this.reliability.listPending();
  }

  @Post('reports/:id/uphold')
  @RequirePermission('admin:dispute:resolve')
  uphold(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reliability.uphold(id, user.id);
  }

  @Post('reports/:id/waive')
  @RequirePermission('admin:dispute:resolve')
  waive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reliability.waive(id, user.id);
  }

  @Get('riders/:riderId')
  @RequirePermission('admin:dispute:resolve')
  rider(@Param('riderId') riderId: string) {
    return this.reliability.riderSummary(riderId);
  }

  @Post('riders/:riderId/strike')
  @RequirePermission('admin:dispute:resolve')
  strike(@Param('riderId') riderId: string, @Body() dto: ManualStrikeDto) {
    return this.reliability.addManualStrike(riderId, dto.jobId ?? 'manual', dto.reason);
  }

  @Post('riders/:riderId/lift-suspension')
  @RequirePermission('admin:dispute:resolve')
  lift(@Param('riderId') riderId: string) {
    return this.reliability.liftSuspension(riderId);
  }
}
