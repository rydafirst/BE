import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { RequirePermission } from '../../common/auth/roles.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { AccountsService } from './accounts.service.js';

// The account holder NAME is resolved server-side via bank name-enquiry — the client only sends
// the bank code + account number, never a name it could fake.
class SetAccountDto {
  @IsString() @Length(3, 6) bankCode!: string;
  @IsString() @Length(10, 10) accountNumber!: string;
  @IsOptional() @IsIn(['refund', 'payout']) type?: 'refund' | 'payout';
}

class ResolveAccountDto {
  @IsString() @Length(3, 6) bankCode!: string;
  @IsString() @Length(10, 10) accountNumber!: string;
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

  // Bank list for the picker so users choose a name instead of typing a code.
  @Get('banks')
  @RequirePermission('account:manage:own')
  banks() {
    return this.accounts.listBanks();
  }

  // Preview the resolved account name before saving (so the user can confirm it's their account).
  @Post('resolve')
  @RequirePermission('account:manage:own')
  resolve(@Body() dto: ResolveAccountDto) {
    return this.accounts.resolve(dto.bankCode, dto.accountNumber);
  }

  @Put()
  @RequirePermission('account:manage:own')
  set(@CurrentUser() user: AuthUser, @Body() dto: SetAccountDto) {
    return this.accounts.set(user.id, dto);
  }
}
