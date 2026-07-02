import { ReportReason } from '@prisma/client';

export type ReportSummary = {
  id: string;
  reason: ReportReason;
  comment: string | null;
  createdAt: Date;
  user: { id: string; username: string };
  offer: { id: string; title: string };
};
