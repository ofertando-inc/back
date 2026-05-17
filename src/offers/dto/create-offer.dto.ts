import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

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

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  storeName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
