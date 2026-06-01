import { VoteType } from '@prisma/client';

export type CommentResponse = {
  id: string;
  content: string | null;
  createdAt: Date;
  editedAt: Date | null;
  user: { id: string; username: string };
  replyTo: { id: string; username: string } | null;
  score: number;
  replyCount: number;
  userVote: VoteType | null;
  deleted: boolean;
};
