import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

// Inline physical address for find-or-create at offer submission.
export class OfferLocationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class CreateOfferDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  offerType: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl()
  externalUrl?: string;

  // Merchant: an existing id OR a name (find-or-create). At least one required.
  @ValidateIf((dto: CreateOfferDto) => !dto.merchantName)
  @IsUUID()
  merchantId?: string;

  @ValidateIf((dto: CreateOfferDto) => !dto.merchantId)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  merchantName?: string;

  // Physical location (required when !isOnline, see service): an existing id OR
  // an inline address (find-or-create under the merchant).
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OfferLocationDto)
  location?: OfferLocationDto;

  // Online-only offer: no location (locationId/location ignored), externalUrl
  // required (enforced in the service).
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  // At least one category; the front populates a multi-select from GET /categories.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds: string[];
}
