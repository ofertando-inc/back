import { HttpStatus, Injectable } from '@nestjs/common';
import { Comment, OfferStatus, Prisma } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import type { CommentResponse } from './types/comment-response.type';

type CommentCursor = {
  createdAt: string;
  id: string;
};

type CommentWithRelations = Comment & {
  user: { id: string; username: string };
  likes?: { id: string }[];
};

@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    offerId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });

      if (!offer || offer.status === OfferStatus.DELETED) {
        throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
      }

      if (
        offer.status !== OfferStatus.ACTIVE &&
        offer.status !== OfferStatus.EXPIRED
      ) {
        throw new AppException(
          ErrorKey.CommentOfferNotCommentable,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (dto.parentId) {
        const parent = await tx.comment.findUnique({
          where: { id: dto.parentId },
        });
        if (!parent || parent.deletedAt || parent.offerId !== offerId) {
          throw new AppException(
            ErrorKey.CommentNotFound,
            HttpStatus.NOT_FOUND,
          );
        }
        if (parent.parentId !== null) {
          throw new AppException(
            ErrorKey.CommentCannotReplyToReply,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const comment = await tx.comment.create({
        data: {
          content: dto.content,
          userId,
          offerId,
          parentId: dto.parentId ?? null,
        },
        include: this.buildInclude(userId),
      });

      await tx.offer.update({
        where: { id: offerId },
        data: { commentCount: { increment: 1 } },
      });

      if (dto.parentId) {
        await tx.comment.update({
          where: { id: dto.parentId },
          data: { replyCount: { increment: 1 } },
        });
      }

      return this.toResponse(comment);
    });
  }

  findThread(
    offerId: string,
    query: ListCommentsQueryDto,
    viewerId?: string,
  ): Promise<PaginatedResult<CommentResponse>> {
    return this.list({ offerId, parentId: null }, query, viewerId);
  }

  findReplies(
    offerId: string,
    parentId: string,
    query: ListCommentsQueryDto,
    viewerId?: string,
  ): Promise<PaginatedResult<CommentResponse>> {
    return this.list({ offerId, parentId }, query, viewerId);
  }

  findRawById(id: string): Promise<Comment | null> {
    return this.prisma.comment.findUnique({ where: { id } });
  }

  async update(id: string, dto: UpdateCommentDto): Promise<CommentResponse> {
    const comment = await this.findRawById(id);

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    const updated = await this.prisma.comment.update({
      where: { id },
      data: { content: dto.content, editedAt: new Date() },
      include: this.buildInclude(comment.userId),
    });

    return this.toResponse(updated);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({ where: { id } });

      if (!comment || comment.deletedAt) {
        throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
      }

      const now = new Date();

      if (comment.parentId === null) {
        const activeReplies = await tx.comment.count({
          where: { parentId: id, deletedAt: null },
        });

        if (activeReplies > 0) {
          await tx.comment.updateMany({
            where: { parentId: id, deletedAt: null },
            data: { deletedAt: now },
          });
        }

        await tx.comment.update({ where: { id }, data: { deletedAt: now } });

        await tx.offer.update({
          where: { id: comment.offerId },
          data: { commentCount: { decrement: 1 + activeReplies } },
        });
      } else {
        await tx.comment.update({ where: { id }, data: { deletedAt: now } });

        await tx.offer.update({
          where: { id: comment.offerId },
          data: { commentCount: { decrement: 1 } },
        });

        await tx.comment.update({
          where: { id: comment.parentId },
          data: { replyCount: { decrement: 1 } },
        });
      }
    });
  }

  private async list(
    scope: { offerId: string; parentId: string | null },
    query: ListCommentsQueryDto,
    viewerId?: string,
  ): Promise<PaginatedResult<CommentResponse>> {
    const limit = query.limit ?? 20;
    const where: Prisma.CommentWhereInput = {
      offerId: scope.offerId,
      parentId: scope.parentId,
      deletedAt: null,
    };

    if (query.cursor) {
      const cursor = decodeCursor<CommentCursor>(query.cursor);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const items = await this.prisma.comment.findMany({
      where,
      include: this.buildInclude(viewerId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((comment) => this.toResponse(comment)),
      nextCursor:
        hasMore && last
          ? encodeCursor<CommentCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private buildInclude(viewerId?: string): Prisma.CommentInclude {
    const include: Prisma.CommentInclude = {
      user: { select: { id: true, username: true } },
    };

    if (viewerId) {
      include.likes = {
        where: { userId: viewerId },
        select: { id: true },
        take: 1,
      };
    }

    return include;
  }

  private toResponse(comment: CommentWithRelations): CommentResponse {
    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      user: comment.user,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      liked: (comment.likes?.length ?? 0) > 0,
    };
  }
}
