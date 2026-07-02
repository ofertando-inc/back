import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export class ListMerchantsQueryDto {
  // Free-text autocomplete over the merchant name (accent/case-insensitive).
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
