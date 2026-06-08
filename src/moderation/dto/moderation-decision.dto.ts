import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class ModerationDecisionDto {
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
