import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { AuthService, type TokenPair } from './auth.service.js';
import { OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto/otp.dto.js';

@Public()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(202)
  async request(@Body() dto: OtpRequestDto): Promise<{ status: 'sent' }> {
    await this.auth.requestOtp(dto.phone, dto.email, dto.name);
    return { status: 'sent' };
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: OtpVerifyDto): Promise<TokenPair> {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.role ?? 'CUSTOMER');
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken);
  }
}
