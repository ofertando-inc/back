import { Offer, VoteType } from '@prisma/client';

export type OfferResponse = Offer & {
  createdByUsername: string;
  userVote: VoteType | null;
};
