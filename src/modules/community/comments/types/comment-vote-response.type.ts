import { VoteType } from '@prisma/client';

export type CommentVoteResponse = {
  score: number;
  userVote: VoteType | null;
};
