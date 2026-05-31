import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { LikeResponse } from './types/like-response.type';

@Injectable()
export class CommentLikesService {
  constructor(private readonly prisma: PrismaService) {}

  async like(userId: string, commentId: string): Promise<LikeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({
        where: { id: commentId },
      });

      if (!comment || comment.deletedAt) {
        throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
      }

      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });

      if (existing) {
        return { likeCount: comment.likeCount, liked: true };
      }

      await tx.commentLike.create({ data: { userId, commentId } });
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
      });

      return { likeCount: updated.likeCount, liked: true };
    });
  }

  async unlike(userId: string, commentId: string): Promise<LikeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({
        where: { id: commentId },
      });

      if (!comment || comment.deletedAt) {
        throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
      }

      const existing = await tx.commentLike.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });

      if (!existing) {
        return { likeCount: comment.likeCount, liked: false };
      }

      await tx.commentLike.delete({ where: { id: existing.id } });
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { likeCount: { decrement: 1 } },
      });

      return { likeCount: updated.likeCount, liked: false };
    });
  }
}
