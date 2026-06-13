import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class ListStoresQueryDto {
  // Free-text autocomplete over store name and city.
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
