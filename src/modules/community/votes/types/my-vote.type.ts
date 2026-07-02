import { VoteType } from '@prisma/client';

export type MyVote = {
  type: VoteType;
  createdAt: Date;
  offer: { id: string; title: string; score: number };
};
