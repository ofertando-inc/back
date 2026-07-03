import { ClaimStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { CursorPaginationQueryDto } from '../../../../common/pagination/cursor-pagination-query.dto';

export class ListClaimsQueryDto extends CursorPaginationQueryDto {
  // The review queue is ?status=PENDING.
  @IsOptional()
  @IsEnum(ClaimStatus)
  status?: ClaimStatus;
}
