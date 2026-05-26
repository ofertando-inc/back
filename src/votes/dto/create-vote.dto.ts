import { VoteType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreateVoteDto {
  @IsEnum(VoteType)
  type: VoteType;
}
