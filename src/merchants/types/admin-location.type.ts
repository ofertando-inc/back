import type { LocationResponse } from './location-response.type';

// A location enriched with its merchant, for the admin moderation queue.
export type AdminLocation = LocationResponse & {
  merchant: { id: string; name: string };
};
