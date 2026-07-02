import { OfferStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export enum OfferSortMode {
  Date = 'date',
  Score = 'score',
  Ending = 'ending',
}

export enum OfferPeriod {
  All = 'all',
  Day = 'day',
  Week = 'week',
  Month = 'month',
  Year = 'year',
}

export class ListOffersQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(OfferSortMode)
  sort?: OfferSortMode = OfferSortMode.Date;

  @IsOptional()
  @IsEnum(OfferPeriod)
  period?: OfferPeriod = OfferPeriod.All;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  city?: string;

  // Filter offers by merchant id.
  @IsOptional()
  @IsUUID()
  merchant?: string;

  @IsOptional()
  @IsString()
  category?: string;

  // "lat,lng" point for the "near me" filter (e.g. "4.61,-74.08").
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/, {
    message: 'near must be "lat,lng"',
  })
  near?: string;

  // Search radius in km for the "near me" filter (defaults to 10 when omitted).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(500)
  radiusKm?: number;

  @IsOptional()
  @IsString()
  offerType?: string;

  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;

  // Public listings include expired offers by default; pass false to hide them.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  includeExpired?: boolean;

  // Filter by channel: true = online-only offers, false = physical ones.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  online?: boolean;
}
