import { AccountType, UserRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorPaginationQueryDto } from '../../../../common/pagination/cursor-pagination-query.dto';
import { trim } from '../../../../common/transformers/trim.transformer';

export class ListAccountsQueryDto extends CursorPaginationQueryDto {
  // Free-text search over email and username (case-insensitive).
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
