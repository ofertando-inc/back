import { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';

// The merchant owned by the authenticated business account, attached by
// BusinessGuard.
export type OwnedMerchant = {
  id: string;
  name: string;
  verified: boolean;
  blockedAt: Date | null;
};

export type BusinessRequest = AuthenticatedRequest & {
  merchant: OwnedMerchant;
};
