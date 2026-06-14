import { Prisma } from '@prisma/client';

// Projection mapping a Merchant row to the public MerchantResponse shape.
export const merchantResponseSelect = {
  id: true,
  name: true,
  verified: true,
  blockedAt: true,
  createdAt: true,
} satisfies Prisma.MerchantSelect;
