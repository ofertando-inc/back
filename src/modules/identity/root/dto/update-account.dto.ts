import { AccountType, UserRole, UserStatus } from '@prisma/client';
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

export class UpdateAccountDto {
  @Transform(trim)
  @IsOptional()
  @IsEmail()
  email?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  // Resets the password (provisional, to be changed by the account holder).
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  // ACTIVE / DISABLED (disabling is how a root retires an account).
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
