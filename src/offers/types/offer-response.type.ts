import { Offer, VoteType } from '@prisma/client';

export type OfferCategory = {
  id: string;
  slug: string;
  name: string;
};

export type OfferStore = {
  id: string;
  name: string;
  city: string;
  verified: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type OfferResponse = Offer & {
  createdByUsername: string;
  userVote: VoteType | null;
  categories: OfferCategory[];
  store: OfferStore | null;
};
