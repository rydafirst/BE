import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';
import { MAX_EXTRA_STOPS } from '../domain/multi-stop.js';

export class GeoPointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class QuoteRequestDto {
  @IsIn(['DELIVERY', 'RIDE', 'ERRAND']) type!: 'DELIVERY' | 'RIDE' | 'ERRAND';
  @ValidateNested() @Type(() => GeoPointDto) pickup!: GeoPointDto;
  @ValidateNested() @Type(() => GeoPointDto) dropoff!: GeoPointDto;
  // #4 MULTI-STOP: extra drop-off POINTS after the primary dropoff, in order. Optional — omitting it
  // is a plain single-stop quote (unchanged). The fare is computed for the FULL multi-leg route and
  // these points are signed into the quote token so they can't be tampered with before createJob.
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_EXTRA_STOPS)
  @ValidateNested({ each: true }) @Type(() => GeoPointDto) stops?: GeoPointDto[];
}

export class RecipientDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(7, 15) phone!: string;
}

// #4 MULTI-STOP: the per-stop metadata for one extra drop-off, paired BY INDEX to the signed quote
// `stops` points (the point is authoritative from the signed quote, never taken from this body). Each
// stop's own recipient receives its own confirmation code.
export class ExtraStopDto {
  @IsOptional() @ValidateNested() @Type(() => RecipientDto) recipient?: RecipientDto;
  @IsOptional() @IsString() @Length(1, 200) item?: string;
  @IsOptional() @IsString() @Length(1, 500) instructions?: string;
  @IsOptional() @IsString() @Length(1, 300) address?: string;
  @IsOptional() @IsString() @Length(1, 120) area?: string;
}

export class CreateJobDto {
  @IsString() @Length(16, 1024) quoteToken!: string;
  // Optional: refunds default to the original payment source; this is only a saved fallback ref.
  @IsOptional() @IsString() @Length(1, 64) refundAccountId?: string;
  @IsOptional() @IsString() @Length(1, 80) customerName?: string;  // sender's name (shown to the rider)
  @IsOptional() @ValidateNested() @Type(() => RecipientDto) recipient?: RecipientDto;
  @IsOptional() @IsIn(['WAIT', 'DELEGATE', 'RETURN']) fallbackPolicy?: 'WAIT' | 'DELEGATE' | 'RETURN';
  @IsOptional() @IsString() @Length(1, 200) item?: string;         // what is being sent
  @IsOptional() @IsNumber() @Min(0) @Max(200) weightKg?: number;   // approx weight, for rider clarity
  @IsOptional() @IsString() @Length(1, 500) instructions?: string; // notes for the rider
  @IsOptional() @IsString() @Length(1, 300) pickupAddress?: string;  // full human-readable label
  @IsOptional() @IsString() @Length(1, 300) dropoffAddress?: string;
  @IsOptional() @IsString() @Length(1, 120) pickupArea?: string;     // coarse neighbourhood
  @IsOptional() @IsString() @Length(1, 120) dropoffArea?: string;
  // #4 MULTI-STOP: metadata for each extra drop-off, in the SAME order and count as the signed quote
  // `stops`. Optional — omit for a single-stop delivery (unchanged). Points come from the signed quote.
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_EXTRA_STOPS)
  @ValidateNested({ each: true }) @Type(() => ExtraStopDto) extraStops?: ExtraStopDto[];
  // Mobile deep-link return target after payment (validated against an allow-list server-side).
  @IsOptional() @IsString() @Length(1, 200) returnUrl?: string;
}

// ERRAND ("buy-for-me"): the customer quotes the store -> customer trip (type ERRAND) and types the
// goods amount. `goodsMinor` is held in escrow and paid to the vendor; the trip is priced like a delivery.
export class CreateErrandDto {
  @IsString() @Length(16, 1024) quoteToken!: string;
  @IsNumber() @Min(100) @Max(100_000_000) goodsMinor!: number; // ₦1 .. ₦1,000,000 (safety ceiling)
  @IsString() @Length(1, 800) shoppingList!: string;           // what to buy
  @IsOptional() @IsString() @Length(1, 120) storeName?: string;
  @IsOptional() @IsString() @Length(1, 120) storeArea?: string;
  @IsOptional() @IsString() @Length(1, 300) storeAddress?: string;
  @IsOptional() @IsString() @Length(1, 300) dropoffAddress?: string; // where to deliver to the customer
  @IsOptional() @IsString() @Length(1, 120) dropoffArea?: string;
  @IsOptional() @IsString() @Length(1, 80) customerName?: string;
  @IsOptional() @IsString() @Length(1, 64) refundAccountId?: string;
  @IsOptional() @IsString() @Length(1, 200) returnUrl?: string;
}

// The rider captures the vendor's BUSINESS account at the store; the server resolves the name for the
// customer to approve. Only these two fields are trusted from the client — the name comes from the bank.
export class VendorAccountDto {
  @IsString() @Length(3, 10) bankCode!: string;
  @IsString() @Length(6, 20) accountNumber!: string;
}

// MARKETPLACE order: buy listed products from a registered vendor. Prices are read server-side from
// the catalog — the body only names the products and quantities.
export class MarketplaceItemDto {
  @IsString() @Length(1, 64) productId!: string;
  @IsNumber() @Min(1) @Max(50) quantity!: number;
}
export class CreateMarketplaceOrderDto {
  @IsString() @Length(1, 64) vendorId!: string;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MarketplaceItemDto) items!: MarketplaceItemDto[];
  @IsString() @Length(16, 1024) quoteToken!: string;
  @IsOptional() @IsString() @Length(1, 300) dropoffAddress?: string;
  @IsOptional() @IsString() @Length(1, 120) dropoffArea?: string;
  @IsOptional() @IsString() @Length(1, 80) customerName?: string;
  @IsOptional() @IsString() @Length(1, 64) refundAccountId?: string;
  @IsOptional() @IsString() @Length(1, 200) returnUrl?: string;
}

// ERRAND top-up: the rider asks the customer to add more when the shop price is higher than declared.
export class ErrandTopUpRequestDto {
  @IsNumber() @Min(100) @Max(100_000_000) additionalMinor!: number; // ₦1 .. ₦1,000,000
}
export class ErrandTopUpStartDto {
  @IsOptional() @IsString() @Length(1, 200) returnUrl?: string;
}
export class ErrandTopUpConfirmDto {
  @IsString() @Length(1, 128) transactionId!: string;
}

export class AdvanceDto {
  @IsIn(['EN_ROUTE_PICKUP', 'AT_PICKUP', 'IN_PROGRESS', 'EN_ROUTE_DROP'])
  to!: 'EN_ROUTE_PICKUP' | 'AT_PICKUP' | 'IN_PROGRESS' | 'EN_ROUTE_DROP';
}

export class ArriveDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  // Optional GPS accuracy (metres) from the device fix; used to tolerate drift near the geofence.
  // Bounded server-side (see MAX_GPS_SLACK_M), so a large value can't defeat the fence.
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
}

export class RetryPaymentDto {
  // Optional deep-link the hosted checkout returns to after payment (allow-listed to rydafirst:// server-side).
  @IsOptional() @IsString() returnUrl?: string;
}

export class ConfirmPaymentDto {
  @IsString() @Length(1, 128) transactionId!: string;
}
