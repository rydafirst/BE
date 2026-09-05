import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class RegisterVendorDto {
  @IsString() @Length(2, 120) businessName!: string;
  @IsOptional() @IsString() @Length(1, 40) rcNumber?: string;
  @IsOptional() @IsString() @Length(1, 60) category?: string;
  @IsOptional() @IsString() @Length(1, 120) area?: string;
  @IsOptional() @IsString() @Length(1, 600) description?: string;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() @Length(2, 120) businessName?: string;
  @IsOptional() @IsString() @Length(0, 40) rcNumber?: string;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) area?: string;
  @IsOptional() @IsString() @Length(0, 600) description?: string;
  @IsOptional() @IsString() @Length(1, 256) logoKey?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) shopLat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) shopLng?: number;
}

export class VendorAccountDto {
  @IsString() @Length(3, 10) bankCode!: string;
  @IsString() @Length(6, 20) accountNumber!: string;
}

export class ImageUploadDto {
  @IsString() @Length(1, 64) contentType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

export class ProductDto {
  @IsString() @Length(1, 120) name!: string;
  @IsInt() @Min(1) @Max(100_000_000) priceMinor!: number;
  @IsOptional() @IsString() @Length(0, 800) description?: string;
  @IsOptional() @IsString({ each: true }) photoKeys?: string[];
  @IsOptional() @IsBoolean() available?: boolean;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) priceMinor?: number;
  @IsOptional() @IsString() @Length(0, 800) description?: string;
  @IsOptional() @IsString({ each: true }) photoKeys?: string[];
  @IsOptional() @IsBoolean() available?: boolean;
}

export class RejectVendorDto {
  @IsString() @Length(1, 300) reason!: string;
}
