import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  // Required by the service when changing email or password; not enforced here
  // since it is only relevant for those changes.
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
