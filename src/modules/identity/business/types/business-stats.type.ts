// Aggregated brand statistics over all of the merchant's offers.
export type BusinessStats = {
  offers: { total: number; active: number };
  views: number;
  clicks: number;
  score: number;
  comments: number;
  reports: number;
};
