import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto';
import { trim } from '../../common/transformers/trim.transformer';

export class ListAdminMerchantsQueryDto extends CursorPaginationQueryDto {
  // Filter by verification status (the front uses false for the moderation queue).
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  verified?: boolean;

  // Filter by block status (true lists blocked merchants).
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  blocked?: boolean;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
