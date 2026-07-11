import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { AccountsService } from './accounts.service.js';

class SetAccountDto {
  @IsString() @Length(3, 6) bankCode!: string;
  @IsString() @Length(10, 10) accountNumber!: string;
  @IsString() @Length(2, 120) accountName!: string;
  @IsOptional() @IsIn(['refund', 'payout']) type?: 'refund' | 'payout';
}

// A user's own bank account (payout for riders, optional fallback refund destination for customers).
@Controller({ path: 'me/account', version: '1' })
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission('account:manage:own')
  get(@CurrentUser() user: AuthUser) {
    return this.accounts.getMasked(user.id);
  }

  @Put()
  @RequirePermission('account:manage:own')
  set(@CurrentUser() user: AuthUser, @Body() dto: SetAccountDto) {
    return this.accounts.set(user.id, dto);
  }
}
