import { Prisma } from '@prisma/client';

// Projection mapping a Location row to the public LocationResponse shape.
export const locationResponseSelect = {
  id: true,
  merchantId: true,
  address: true,
  city: true,
  region: true,
  latitude: true,
  longitude: true,
  verified: true,
  createdAt: true,
} satisfies Prisma.LocationSelect;
