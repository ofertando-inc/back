import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class RegisterDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @MinLength(8)
  password: string;
}
