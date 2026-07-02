import { VoteType } from '@prisma/client';

export type VoteResponse = {
  score: number;
  userVote: VoteType | null;
};
