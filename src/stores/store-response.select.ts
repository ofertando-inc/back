import { Prisma } from '@prisma/client';

// Shared projection mapping a Store row to the public StoreResponse shape.
export const storeResponseSelect = {
  id: true,
  name: true,
  city: true,
  region: true,
  address: true,
  latitude: true,
  longitude: true,
  verified: true,
  createdAt: true,
} satisfies Prisma.StoreSelect;
