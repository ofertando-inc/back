import { VoteType } from '@prisma/client';

export type UserVoteResponse = {
  type: VoteType | null;
};
