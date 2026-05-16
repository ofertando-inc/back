import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
