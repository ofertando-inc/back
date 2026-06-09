import {
  CommentReportReason,
  ReportReason,
  ReportStatus,
} from '@prisma/client';

export type CommentReportDetail = {
  id: string;
  reason: CommentReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
  user: { id: string; username: string };
};

export type OfferReportDetail = {
  id: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
  user: { id: string; username: string };
};
