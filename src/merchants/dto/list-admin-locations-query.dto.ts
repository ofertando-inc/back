import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto';

export class ListAdminLocationsQueryDto extends CursorPaginationQueryDto {
  // Filter by verification status (the front uses false for the moderation queue).
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsUUID()
  merchant?: string;
}
