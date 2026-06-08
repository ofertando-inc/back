import { CommentReportReason, ReportReason } from '@prisma/client';

export type CommentReportDetail = {
  id: string;
  reason: CommentReportReason;
  note: string | null;
  createdAt: Date;
  user: { id: string; username: string };
};

export type OfferReportDetail = {
  id: string;
  reason: ReportReason;
  note: string | null;
  createdAt: Date;
  user: { id: string; username: string };
};
