import { OfferStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum OfferSortMode {
  Date = 'date',
  Score = 'score',
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

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  offerType?: string;

  @IsOptional()
  @IsEnum(OfferStatus)
  status?: OfferStatus;
}
