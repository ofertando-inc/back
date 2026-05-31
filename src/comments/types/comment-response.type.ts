export type CommentResponse = {
  id: string;
  content: string | null;
  createdAt: Date;
  editedAt: Date | null;
  user: { id: string; username: string };
  likeCount: number;
  replyCount: number;
  liked: boolean;
  deleted: boolean;
};
