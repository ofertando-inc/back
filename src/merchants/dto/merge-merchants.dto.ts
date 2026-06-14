import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class MergeMerchantsDto {
  // Duplicate merchant whose locations and offers move over, then deleted.
  @IsUUID()
  sourceId: string;

  // Canonical merchant that absorbs the source and is kept.
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
