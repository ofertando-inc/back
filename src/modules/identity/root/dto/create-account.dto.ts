import { AccountType, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export class CreateAccountDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  username: string;

  // Provisional password, to be changed by the account holder.
  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
