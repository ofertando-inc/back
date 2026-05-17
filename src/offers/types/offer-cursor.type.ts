export interface DateCursor {
  createdAt: string;
  id: string;
}

export interface ScoreCursor {
  score: number;
  createdAt: string;
  id: string;
}

export type OfferCursor = DateCursor | ScoreCursor;
