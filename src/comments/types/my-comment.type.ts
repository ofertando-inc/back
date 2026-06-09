export type MyComment = {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  score: number;
  replyCount: number;
  hidden: boolean;
  offer: { id: string; title: string };
};
