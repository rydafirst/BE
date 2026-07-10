import { Body, Controller, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { RiderKycService } from './rider-kyc.service.js';

class KycSubmitDto {
  @IsBoolean() ninVerified!: boolean;
  @IsBoolean() bvnVerified!: boolean;
  @IsBoolean() idDocUploaded!: boolean;
  @IsBoolean() selfieMatched!: boolean;
  @IsBoolean() addressProvided!: boolean;
}

@Controller({ path: 'riders', version: '1' })
export class RidersController {
  constructor(private readonly kyc: RiderKycService) {}

  @Post('kyc')
  submit(@CurrentUser() user: AuthUser, @Body() dto: KycSubmitDto) {
    return this.kyc.submit(user.id, dto);
  }
}
