export type MerchantResponse = {
  id: string;
  name: string;
  verified: boolean;
  blockedAt: Date | null;
  createdAt: Date;
};
