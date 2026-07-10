import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { WalletService } from './wallet.service.js';

@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @RequirePermission('wallet:read:own')
  mine(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id);
  }
}
