import { Offer, VoteType } from '@prisma/client';

export type OfferCategory = {
  id: string;
  slug: string;
  name: string;
};

export type OfferMerchant = {
  id: string;
  name: string;
  verified: boolean;
};

export type OfferLocation = {
  id: string;
  address: string;
  city: string;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
};

export type OfferResponse = Offer & {
  createdByUsername: string;
  userVote: VoteType | null;
  categories: OfferCategory[];
  merchant: OfferMerchant;
  location: OfferLocation | null;
};
