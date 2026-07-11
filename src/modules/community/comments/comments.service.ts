import { HttpStatus, Injectable } from '@nestjs/common';
import { Comment, OfferStatus, Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import type { CursorPaginationQueryDto } from '../../../common/pagination/cursor-pagination-query.dto';
import {
  decodeCursor,
  encodeCursor,
} from '../../../common/pagination/cursor.helper';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { MetricsService } from '../../../metrics/metrics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import type { CommentResponse } from './types/comment-response.type';
import type { MyComment } from './types/my-comment.type';

type CommentCursor = {
  createdAt: string;
  id: string;
};

const COMMENT_INCLUDE = {
  user: { select: { id: true, username: true } },
  replyTo: { select: { id: true, user: { select: { username: true } } } },
  votes: { select: { type: true } },
} satisfies Prisma.CommentInclude;

// A comment that is visible normally: neither author-deleted nor moderator-hidden.
const LIVE_COMMENT = {
  deletedAt: null,
  hiddenAt: null,
} satisfies Prisma.CommentWhereInput;

type CommentWithRelations = Prisma.CommentGetPayload<{
  include: typeof COMMENT_INCLUDE;
}>;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  async create(
    userId: string,
    offerId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    const response = await this.prisma.$transaction(async (tx) => {
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

      // Threading stays one level deep: parentId always points to the thread
      // root. Replying to a reply is allowed — it is flattened under the root
      // and records replyToId so the client can show "replying to @user".
      let parentId: string | null = null;
      let replyToId: string | null = null;

      if (dto.parentId) {
        const target = await tx.comment.findUnique({
          where: { id: dto.parentId },
        });
        if (!target || target.deletedAt || target.offerId !== offerId) {
          throw new AppException(
            ErrorKey.CommentNotFound,
            HttpStatus.NOT_FOUND,
          );
        }
        if (target.parentId === null) {
          // Replying directly to a root comment.
          parentId = target.id;
        } else {
          // Replying to a reply: flatten under its root, tag the target.
          parentId = target.parentId;
          replyToId = target.id;
        }
      }

      const comment = await tx.comment.create({
        data: { content: dto.content, userId, offerId, parentId, replyToId },
        include: this.buildInclude(userId),
      });

      await tx.offer.update({
        where: { id: offerId },
        data: { commentCount: { increment: 1 } },
      });

      if (parentId) {
        await tx.comment.update({
          where: { id: parentId },
          data: { replyCount: { increment: 1 } },
        });
      }

      return this.toResponse(comment);
    });

    this.metricsService.commentCreated();

    return response;
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

  async softDelete(id: string): Promise<CommentResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({ where: { id } });

      if (!comment || comment.deletedAt) {
        throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
      }

      // Tombstone: mark the comment as deleted but keep its replies intact. A
      // deleted top-level comment that still has live replies is shown as a
      // placeholder in the thread; one without live replies (and any deleted
      // reply) simply drops out of the listings. No cascade.
      const updated = await tx.comment.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: this.buildInclude(),
      });

      await tx.offer.update({
        where: { id: comment.offerId },
        data: { commentCount: { decrement: 1 } },
      });

      if (comment.parentId) {
        await tx.comment.update({
          where: { id: comment.parentId },
          data: { replyCount: { decrement: 1 } },
        });
      }

      return this.toResponse(updated);
    });
  }

  private async list(
    scope: { offerId: string; parentId: string | null },
    query: ListCommentsQueryDto,
    viewerId?: string,
  ): Promise<PaginatedResult<CommentResponse>> {
    const limit = query.limit ?? 20;
    const where: Prisma.CommentWhereInput =
      scope.parentId === null
        ? {
            offerId: scope.offerId,
            parentId: null,
            // Live top-level comments, plus tombstones: comments removed by
            // their author (deletedAt) or by a moderator (hiddenAt) that still
            // have at least one live reply, so the thread is preserved.
            OR: [
              LIVE_COMMENT,
              {
                OR: [{ deletedAt: { not: null } }, { hiddenAt: { not: null } }],
                replies: { some: LIVE_COMMENT },
              },
            ],
          }
        : {
            offerId: scope.offerId,
            parentId: scope.parentId,
            ...LIVE_COMMENT,
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

  // Comments authored by a given user across every offer, most recent first.
  // Author-deleted tombstones are excluded; moderator-hidden ones are kept with
  // a `hidden` flag and their content intact so the author still sees what they
  // wrote.
  async findByUser(
    userId: string,
    query: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<MyComment>> {
    const limit = query.limit ?? 20;
    const where: Prisma.CommentWhereInput = { userId, deletedAt: null };

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
      include: { offer: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        score: comment.score,
        replyCount: comment.replyCount,
        hidden: comment.hiddenAt !== null,
        offer: comment.offer,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor<CommentCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private buildInclude(viewerId?: string) {
    return {
      ...COMMENT_INCLUDE,
      votes: {
        where: { userId: viewerId ?? '' },
        select: { type: true },
        take: 1,
      },
    } satisfies Prisma.CommentInclude;
  }

  private toResponse(comment: CommentWithRelations): CommentResponse {
    const deleted = comment.deletedAt !== null;
    const hidden = comment.hiddenAt !== null;
    // Content is masked whether the comment was removed by its author or hidden
    // by a moderator; the client distinguishes the two via the flags below.
    const removed = deleted || hidden;
    return {
      id: comment.id,
      content: removed ? null : comment.content,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      user: comment.user,
      replyTo: comment.replyTo
        ? { id: comment.replyTo.id, username: comment.replyTo.user.username }
        : null,
      score: comment.score,
      replyCount: comment.replyCount,
      userVote: comment.votes?.[0]?.type ?? null,
      deleted,
      hidden,
    };
  }
}
