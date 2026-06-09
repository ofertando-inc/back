import { OfferStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

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

  @IsOptional()
  @IsString()
  store?: string;

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
}
