import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class MergeStoresDto {
  // Duplicate store whose offers are moved over, then deleted.
  @IsUUID()
  sourceId: string;

  // Canonical store that absorbs the source's offers and is kept.
  @IsUUID()
  targetId: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
