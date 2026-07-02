import { ClaimStatus } from '@prisma/client';

export type ClaimResponse = {
  id: string;
  status: ClaimStatus;
  note: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  user: { id: string; email: string; username: string };
  merchant: { id: string; name: string };
  reviewedBy: { id: string; username: string } | null;
};
