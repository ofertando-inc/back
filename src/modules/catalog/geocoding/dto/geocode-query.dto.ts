import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export class GeocodeQueryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  q: string;
}
