import { Offer, VoteType } from '@prisma/client';

export type OfferCategory = {
  id: string;
  slug: string;
  name: string;
};

export type OfferResponse = Offer & {
  createdByUsername: string;
  userVote: VoteType | null;
  categories: OfferCategory[];
};
