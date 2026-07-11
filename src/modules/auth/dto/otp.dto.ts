import { IsEmail, IsIn, IsOptional, IsString, Matches, Length } from 'class-validator';

export class OtpRequestDto {
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  phone!: string;

  // Where to deliver the code while OTP_CHANNEL=email (SMS via Termii is blocked pending
  // business registration). Required by the service when the email channel is active.
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;
}

export class OtpVerifyDto {
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'RIDER'])
  role?: 'CUSTOMER' | 'RIDER';
}

export class RefreshDto {
  @IsString()
  @Length(16, 512)
  refreshToken!: string;
}
