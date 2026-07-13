import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { DisputeService } from './dispute.service.js';

class OpenDisputeDto {
  @IsOptional() @IsBoolean() counterEvidence?: boolean;
}
class ResolveDisputeDto {
  @IsIn(['RELEASE', 'REFUND', 'SPLIT']) resolution!: 'RELEASE' | 'REFUND' | 'SPLIT';
  @IsOptional() @IsInt() @Min(0) riderShareMinor?: number;
}
class BanTheftDto {
  @IsOptional() @IsString() @Length(6, 40) nin?: string;
  @IsOptional() @IsString() @Length(6, 40) bvn?: string;
  @IsOptional() @IsString() @Length(6, 200) deviceId?: string;
  @IsString() @Length(3, 300) reason!: string;
}

@Controller({ version: '1' })
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  // Participant opens a dispute on their job.
  @Post('jobs/:id/disputes')
  @RequirePermission('job:read:own')
  open(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OpenDisputeDto) {
    return this.disputes.open(user.id, id, dto.counterEvidence ?? false);
  }

  // Admin: list all disputes for review (declared before :id routes elsewhere is N/A here).
  @Get('admin/disputes')
  @RequirePermission('admin:dispute:resolve')
  list() {
    return this.disputes.list();
  }

  // Admin resolves an escalated dispute.
  @Post('admin/disputes/:id/resolve')
  @RequirePermission('admin:dispute:resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputes.resolve(id, dto.resolution, dto.riderShareMinor);
  }

  // Admin bans an identity + device on confirmed theft.
  @Post('admin/riders/ban-theft')
  @RequirePermission('admin:dispute:resolve')
  ban(@Body() dto: BanTheftDto) {
    return this.disputes.banForTheft(dto);
  }
}
