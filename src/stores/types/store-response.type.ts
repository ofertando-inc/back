export type StoreResponse = {
  id: string;
  name: string;
  city: string;
  region: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  createdAt: Date;
};
