import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
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

  // At least one category; the front populates a multi-select from GET /categories.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds: string[];

  // Optional link to an existing store (from GET /stores autocomplete).
  @IsOptional()
  @IsUUID()
  storeId?: string;
}
