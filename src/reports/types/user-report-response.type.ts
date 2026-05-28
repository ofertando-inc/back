import { ReportReason } from '@prisma/client';

export type UserReportResponse = {
  reason: ReportReason | null;
};
