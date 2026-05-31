export type CommentResponse = {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  user: { id: string; username: string };
  likeCount: number;
  replyCount: number;
  liked: boolean;
};
