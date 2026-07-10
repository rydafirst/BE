import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { ConfirmationService } from './confirmation.service.js';

class ConfirmCodeDto {
  @IsString() @Length(4, 8) code!: string;
}

@Controller({ path: 'jobs', version: '1' })
export class ConfirmationController {
  constructor(private readonly confirmations: ConfirmationService) {}

  /** System/customer issues the receiver code (e.g., when the rider arrives). */
  @Post(':id/issue-code')
  @RequirePermission('job:read:own')
  issue(@Param('id') id: string) {
    return this.confirmations.issueDeliveryCode(id);
  }

  /** Rider submits the receiver's code -> releases escrow. */
  @Post(':id/confirm-code')
  @RequirePermission('job:accept')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmCodeDto) {
    return this.confirmations.confirmDelivery(user.id, id, dto.code);
  }
}
