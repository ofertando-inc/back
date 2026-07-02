import { VoteType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class VoteCommentDto {
  @IsEnum(VoteType)
  type: VoteType;
}
