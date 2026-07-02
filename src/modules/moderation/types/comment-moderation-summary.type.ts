export type CommentModerationSummary = {
  id: string;
  content: string;
  reportCount: number;
  hiddenAt: Date | null;
  createdAt: Date;
  user: { id: string; username: string };
  offer: { id: string; title: string };
};
