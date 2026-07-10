import { IsIn, IsOptional, IsString, Matches, Length } from 'class-validator';

export class OtpRequestDto {
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  phone!: string;
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
