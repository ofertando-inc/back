export type LocationResponse = {
  id: string;
  merchantId: string;
  address: string;
  city: string;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  createdAt: Date;
};
