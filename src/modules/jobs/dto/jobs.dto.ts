import { Type } from 'class-transformer';
import {
  IsIn, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';

export class GeoPointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class QuoteRequestDto {
  @IsIn(['DELIVERY', 'RIDE']) type!: 'DELIVERY' | 'RIDE';
  @ValidateNested() @Type(() => GeoPointDto) pickup!: GeoPointDto;
  @ValidateNested() @Type(() => GeoPointDto) dropoff!: GeoPointDto;
}

export class RecipientDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(7, 15) phone!: string;
}

export class CreateJobDto {
  @IsString() @Length(16, 1024) quoteToken!: string;
  // Optional: refunds default to the original payment source; this is only a saved fallback ref.
  @IsOptional() @IsString() @Length(1, 64) refundAccountId?: string;
  @IsOptional() @ValidateNested() @Type(() => RecipientDto) recipient?: RecipientDto;
  @IsOptional() @IsIn(['WAIT', 'DELEGATE', 'RETURN']) fallbackPolicy?: 'WAIT' | 'DELEGATE' | 'RETURN';
  @IsOptional() @IsString() @Length(1, 200) item?: string;         // what is being sent
  @IsOptional() @IsString() @Length(1, 500) instructions?: string; // notes for the rider
  @IsOptional() @IsString() @Length(1, 300) pickupAddress?: string;  // human-readable label
  @IsOptional() @IsString() @Length(1, 300) dropoffAddress?: string; // human-readable label
}

export class AdvanceDto {
  @IsIn(['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'])
  to!: 'EN_ROUTE_PICKUP' | 'AT_PICKUP' | 'IN_PROGRESS' | 'EN_ROUTE_DROP';
}

export class ArriveDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class ConfirmPaymentDto {
  @IsString() @Length(1, 128) transactionId!: string;
}
