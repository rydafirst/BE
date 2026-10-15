import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { ReferralsService } from './referrals.service.js';

class ClaimDto {
  @IsString() @Length(4, 16) code!: string;
}

/** Rider-facing referral endpoints — each scoped to the signed-in rider. */
@Controller({ path: 'me/referrals', version: '1' })
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @RequirePermission('referral:read:own')
  mine(@CurrentUser() user: AuthUser) {
    return this.referrals.mine(user.id);
  }

  @Post('claim')
  @RequirePermission('referral:read:own')
  claim(@CurrentUser() user: AuthUser, @Body() dto: ClaimDto) {
    return this.referrals.claim(user.id, dto.code);
  }
}

/** Admin referral management — list, credit (pay the referrer), reject. */
@Controller({ path: 'admin/referrals', version: '1' })
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @RequirePermission('admin:finance:read')
  list() {
    return this.referrals.adminList();
  }

  @Post(':id/credit')
  @RequirePermission('admin:finance:manage')
  credit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.referrals.credit(id, user.id);
  }

  @Post(':id/reject')
  @RequirePermission('admin:finance:manage')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.referrals.reject(id, user.id);
  }
}
