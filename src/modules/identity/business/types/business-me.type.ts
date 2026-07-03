import { ClaimStatus } from '@prisma/client';

import type { MerchantResponse } from '../../../catalog/merchants/types/merchant-response.type';
import type { PublicUser } from '../../users/types/public-user.type';

export type BusinessMe = {
  user: PublicUser;
  merchant: MerchantResponse;
  claim: {
    id: string;
    status: ClaimStatus;
    createdAt: Date;
    resolvedAt: Date | null;
  } | null;
};
