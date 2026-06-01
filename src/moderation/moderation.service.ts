import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfferStatus, Prisma, UserStatus } from '@prisma/client';

import { RefreshTokensService } from '../auth/refresh-tokens.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListOffersQueryDto } from '../offers/dto/list-offers-query.dto';
import { OffersService } from '../offers/offers.service';
import type { OfferResponse } from '../offers/types/offer-response.type';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/types/public-user.type';
import { ListReportedCommentsQueryDto } from './dto/list-reported-comments-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import type { CommentModerationSummary } from './types/comment-moderation-summary.type';
import type { ReportSummary } from './types/report-summary.type';

type ReportCursor = {
  createdAt: string;
  id: string;
};

type CommentReportCursor = {
  reportCount: number;
  createdAt: string;
  id: string;
};

const DEFAULT_COMMENT_REPORT_THRESHOLD = 5;

const commentModerationInclude = {
  user: { select: { id: true, username: true } },
  offer: { select: { id: true, title: true } },
} satisfies Prisma.CommentInclude;

type CommentWithModerationRelations = Prisma.CommentGetPayload<{
  include: typeof commentModerationInclude;
}>;

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offersService: OffersService,
    private readonly refreshTokensService: RefreshTokensService,
    private readonly configService: ConfigService,
  ) {}

  listOffers(
    query: ListOffersQueryDto,
    viewerId: string,
  ): Promise<PaginatedResult<OfferResponse>> {
    return this.offersService.findAll(query, { viewerId, admin: true });
  }

  async disableOffer(
    offerId: string,
    viewerId: string,
  ): Promise<OfferResponse> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    if (
      offer.status !== OfferStatus.ACTIVE &&
      offer.status !== OfferStatus.REPORTED
    ) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.DISABLED, disabledAt: new Date() },
    });

    return this.findEnrichedOffer(offerId, viewerId);
  }

  async restoreOffer(
    offerId: string,
    viewerId: string,
  ): Promise<OfferResponse> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
    });

    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    if (
      offer.status !== OfferStatus.DISABLED &&
      offer.status !== OfferStatus.REPORTED
    ) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction([
      this.prisma.report.deleteMany({ where: { offerId } }),
      this.prisma.offer.update({
        where: { id: offerId },
        data: {
          status: OfferStatus.ACTIVE,
          disabledAt: null,
          reportCount: 0,
        },
      }),
    ]);

    return this.findEnrichedOffer(offerId, viewerId);
  }

  async listReports(
    query: ListReportsQueryDto,
  ): Promise<PaginatedResult<ReportSummary>> {
    const limit = query.limit ?? 20;
    const where = query.cursor
      ? this.buildReportCursorWhere(decodeCursor<ReportCursor>(query.cursor))
      : {};

    const items = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        user: { select: { id: true, username: true } },
        offer: { select: { id: true, title: true } },
      },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((report) => ({
        id: report.id,
        reason: report.reason,
        comment: report.comment,
        createdAt: report.createdAt,
        user: report.user,
        offer: report.offer,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor<ReportCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async disableUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });

    if (!user) {
      throw new AppException(ErrorKey.UserNotFound, HttpStatus.NOT_FOUND);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        ErrorKey.UserInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DISABLED },
      select: publicUserSelect,
    });

    await this.refreshTokensService.revokeAllForUser(userId);

    return updated;
  }

  async restoreUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });

    if (!user) {
      throw new AppException(ErrorKey.UserNotFound, HttpStatus.NOT_FOUND);
    }

    if (user.status !== UserStatus.DISABLED) {
      throw new AppException(
        ErrorKey.UserInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
      select: publicUserSelect,
    });
  }

  async listReportedComments(
    query: ListReportedCommentsQueryDto,
  ): Promise<PaginatedResult<CommentModerationSummary>> {
    const limit = query.limit ?? 20;
    const threshold = this.commentReportThreshold();

    // Moderation queue: live comments that crossed the report threshold and
    // have not been handled (hidden) yet, most-reported first.
    const where: Prisma.CommentWhereInput = {
      reportCount: { gte: threshold },
      hiddenAt: null,
      deletedAt: null,
    };

    if (query.cursor) {
      const c = decodeCursor<CommentReportCursor>(query.cursor);
      const createdAt = new Date(c.createdAt);
      where.AND = [
        {
          OR: [
            { reportCount: { lt: c.reportCount } },
            { reportCount: c.reportCount, createdAt: { lt: createdAt } },
            { reportCount: c.reportCount, createdAt, id: { lt: c.id } },
          ],
        },
      ];
    }

    const items = await this.prisma.comment.findMany({
      where,
      orderBy: [{ reportCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: commentModerationInclude,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((comment) => this.toCommentSummary(comment)),
      nextCursor:
        hasMore && last
          ? encodeCursor<CommentReportCursor>({
              reportCount: last.reportCount,
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async hideComment(commentId: string): Promise<CommentModerationSummary> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    if (comment.hiddenAt) {
      throw new AppException(
        ErrorKey.CommentInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Hiding removes the comment from public view, so it stops counting toward
    // the offer commentCount (and its root replyCount), like an author deletion.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.comment.update({
        where: { id: commentId },
        data: { hiddenAt: new Date() },
      }),
      this.prisma.offer.update({
        where: { id: comment.offerId },
        data: { commentCount: { decrement: 1 } },
      }),
    ];

    if (comment.parentId) {
      ops.push(
        this.prisma.comment.update({
          where: { id: comment.parentId },
          data: { replyCount: { decrement: 1 } },
        }),
      );
    }

    await this.prisma.$transaction(ops);

    return this.findCommentSummary(commentId);
  }

  async restoreComment(commentId: string): Promise<CommentModerationSummary> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    // Nothing to clear: the comment is neither hidden nor reported.
    if (!comment.hiddenAt && comment.reportCount === 0) {
      throw new AppException(
        ErrorKey.CommentInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.commentReport.deleteMany({ where: { commentId } }),
      this.prisma.comment.update({
        where: { id: commentId },
        data: { hiddenAt: null, reportCount: 0 },
      }),
    ];

    // Only a hidden comment was uncounted; un-hiding it restores the counts.
    // A merely-reported (still visible) comment was always counted.
    if (comment.hiddenAt) {
      ops.push(
        this.prisma.offer.update({
          where: { id: comment.offerId },
          data: { commentCount: { increment: 1 } },
        }),
      );

      if (comment.parentId) {
        ops.push(
          this.prisma.comment.update({
            where: { id: comment.parentId },
            data: { replyCount: { increment: 1 } },
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);

    return this.findCommentSummary(commentId);
  }

  private async findCommentSummary(
    commentId: string,
  ): Promise<CommentModerationSummary> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: commentModerationInclude,
    });

    if (!comment) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    return this.toCommentSummary(comment);
  }

  private toCommentSummary(
    comment: CommentWithModerationRelations,
  ): CommentModerationSummary {
    return {
      id: comment.id,
      content: comment.content,
      reportCount: comment.reportCount,
      hiddenAt: comment.hiddenAt,
      createdAt: comment.createdAt,
      user: comment.user,
      offer: comment.offer,
    };
  }

  private commentReportThreshold(): number {
    const value = this.configService.get<number>('commentReports.threshold');
    return typeof value === 'number' && value > 0
      ? value
      : DEFAULT_COMMENT_REPORT_THRESHOLD;
  }

  private async findEnrichedOffer(
    offerId: string,
    viewerId: string,
  ): Promise<OfferResponse> {
    const enriched = await this.offersService.findById(offerId, viewerId, {
      includeNonActive: true,
    });
    if (!enriched) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }
    return enriched;
  }

  private buildReportCursorWhere(cursor: ReportCursor) {
    const createdAt = new Date(cursor.createdAt);
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ],
    };
  }
}
