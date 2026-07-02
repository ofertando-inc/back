import { CommentReportReason } from '@prisma/client';

export type CommentReportResponse = {
  reportCount: number;
};

export type UserCommentReportResponse = {
  reason: CommentReportReason | null;
};
