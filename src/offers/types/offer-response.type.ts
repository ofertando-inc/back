import { Offer } from '@prisma/client';

export type OfferResponse = Offer & {
  createdByUsername: string;
};
