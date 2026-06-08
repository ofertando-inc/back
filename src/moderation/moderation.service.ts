import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ModerationAction,
  ModerationTargetType,
  OfferStatus,
  Prisma,
  ReportStatus,
  UserStatus,
} from '@prisma/client';

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
import { ListModerationLogQueryDto } from './dto/list-moderation-log-query.dto';
import { ListReportedCommentsQueryDto } from './dto/list-reported-comments-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import type { CommentModerationSummary } from './types/comment-moderation-summary.type';
import type { ModerationLogEntry } from './types/moderation-log-entry.type';
import type {
  CommentReportDetail,
  OfferReportDetail,
} from './types/report-detail.type';
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

    // Disabling takes a moderation decision: the pending reports are resolved.
    await this.prisma.$transaction([
      this.prisma.offer.update({
        where: { id: offerId },
        data: {
          status: OfferStatus.DISABLED,
          disabledAt: new Date(),
          reportCount: 0,
        },
      }),
      this.prisma.report.updateMany({
        where: { offerId, status: ReportStatus.PENDING },
        data: { status: ReportStatus.RESOLVED, resolvedAt: new Date() },
      }),
    ]);

    return this.findEnrichedOffer(offerId, viewerId);
  }

  async dismissOfferReports(
    offerId: string,
    viewerId: string,
  ): Promise<OfferResponse> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
    });

    if (!offer || offer.status === OfferStatus.DELETED) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    // Dismiss = the reports are unfounded: clear them and keep the offer.
    if (offer.reportCount === 0) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    // A REPORTED offer goes back to ACTIVE; other statuses (e.g. EXPIRED) keep
    // their state, we only clear the reports.
    const data: Prisma.OfferUpdateInput = { reportCount: 0 };
    if (offer.status === OfferStatus.REPORTED) {
      data.status = OfferStatus.ACTIVE;
    }

    await this.prisma.$transaction([
      this.prisma.report.updateMany({
        where: { offerId, status: ReportStatus.PENDING },
        data: { status: ReportStatus.DISMISSED, resolvedAt: new Date() },
      }),
      this.prisma.offer.update({ where: { id: offerId }, data }),
    ]);

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

    // Restore only re-activates a disabled offer (its reports stay RESOLVED).
    // Use dismiss to clear the reports of a still-public REPORTED offer.
    if (offer.status !== OfferStatus.DISABLED) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.ACTIVE, disabledAt: null, reportCount: 0 },
    });

    return this.findEnrichedOffer(offerId, viewerId);
  }

  async listReports(
    query: ListReportsQueryDto,
  ): Promise<PaginatedResult<ReportSummary>> {
    const limit = query.limit ?? 20;
    // Moderation queue: only reports still awaiting a decision.
    const where: Prisma.ReportWhereInput = { status: ReportStatus.PENDING };
    if (query.cursor) {
      where.AND = [
        this.buildReportCursorWhere(decodeCursor<ReportCursor>(query.cursor)),
      ];
    }

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

  async listCommentReports(
    commentId: string,
    query: ListReportsQueryDto,
  ): Promise<PaginatedResult<CommentReportDetail>> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    const limit = query.limit ?? 20;
    const where: Prisma.CommentReportWhereInput = { commentId };
    if (query.cursor) {
      where.AND = [
        this.buildReportCursorWhere(decodeCursor<ReportCursor>(query.cursor)),
      ];
    }

    const items = await this.prisma.commentReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { user: { select: { id: true, username: true } } },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((report) => ({
        id: report.id,
        reason: report.reason,
        note: report.note,
        status: report.status,
        createdAt: report.createdAt,
        user: report.user,
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

  async listOfferReports(
    offerId: string,
    query: ListReportsQueryDto,
  ): Promise<PaginatedResult<OfferReportDetail>> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
    });
    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    const limit = query.limit ?? 20;
    const where: Prisma.ReportWhereInput = { offerId };
    if (query.cursor) {
      where.AND = [
        this.buildReportCursorWhere(decodeCursor<ReportCursor>(query.cursor)),
      ];
    }

    const items = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { user: { select: { id: true, username: true } } },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((report) => ({
        id: report.id,
        reason: report.reason,
        // the offer Report stores its free-text in the `comment` column
        note: report.comment,
        status: report.status,
        createdAt: report.createdAt,
        user: report.user,
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

  async listModerationLog(
    query: ListModerationLogQueryDto,
  ): Promise<PaginatedResult<ModerationLogEntry>> {
    const limit = query.limit ?? 20;
    const where: Prisma.ModerationLogWhereInput = {};
    if (query.cursor) {
      where.AND = [
        this.buildReportCursorWhere(decodeCursor<ReportCursor>(query.cursor)),
      ];
    }

    const items = await this.prisma.moderationLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { actor: { select: { id: true, username: true } } },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((entry) => ({
        id: entry.id,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        note: entry.note,
        createdAt: entry.createdAt,
        actor: entry.actor,
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

  async hideComment(
    commentId: string,
    actorId: string,
    decision?: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
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

    // Hiding takes a moderation decision: the pending reports are resolved and
    // the comment leaves public view, so it stops counting toward the offer
    // commentCount (and its root replyCount), like an author deletion.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.comment.update({
        where: { id: commentId },
        data: { hiddenAt: new Date(), reportCount: 0 },
      }),
      this.prisma.commentReport.updateMany({
        where: { commentId, status: ReportStatus.PENDING },
        data: { status: ReportStatus.RESOLVED, resolvedAt: new Date() },
      }),
      this.prisma.offer.update({
        where: { id: comment.offerId },
        data: { commentCount: { decrement: 1 } },
      }),
      this.logEntry(
        actorId,
        ModerationAction.HIDE_COMMENT,
        ModerationTargetType.COMMENT,
        commentId,
        decision,
      ),
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

  async dismissComment(
    commentId: string,
    actorId: string,
    decision?: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    // Dismiss = the reports are unfounded: clear them and keep the comment
    // visible. Nothing to do if it is hidden or has no pending report.
    if (comment.hiddenAt || comment.reportCount === 0) {
      throw new AppException(
        ErrorKey.CommentInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.$transaction([
      this.prisma.commentReport.updateMany({
        where: { commentId, status: ReportStatus.PENDING },
        data: { status: ReportStatus.DISMISSED, resolvedAt: new Date() },
      }),
      this.prisma.comment.update({
        where: { id: commentId },
        data: { reportCount: 0 },
      }),
      this.logEntry(
        actorId,
        ModerationAction.DISMISS_COMMENT,
        ModerationTargetType.COMMENT,
        commentId,
        decision,
      ),
    ]);

    return this.findCommentSummary(commentId);
  }

  async restoreComment(
    commentId: string,
    actorId: string,
    decision?: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    // Restore only un-hides a moderator-hidden comment. Its reports stay
    // RESOLVED (history is kept); use dismiss to clear a reported-but-visible one.
    if (!comment.hiddenAt) {
      throw new AppException(
        ErrorKey.CommentInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.comment.update({
        where: { id: commentId },
        data: { hiddenAt: null },
      }),
      this.prisma.offer.update({
        where: { id: comment.offerId },
        data: { commentCount: { increment: 1 } },
      }),
      this.logEntry(
        actorId,
        ModerationAction.RESTORE_COMMENT,
        ModerationTargetType.COMMENT,
        commentId,
        decision,
      ),
    ];

    if (comment.parentId) {
      ops.push(
        this.prisma.comment.update({
          where: { id: comment.parentId },
          data: { replyCount: { increment: 1 } },
        }),
      );
    }

    await this.prisma.$transaction(ops);

    return this.findCommentSummary(commentId);
  }

  // Builds a moderation-log create to push into an action's transaction, so the
  // decision (actor, reason, note) is recorded atomically with its effect.
  private logEntry(
    actorId: string,
    action: ModerationAction,
    targetType: ModerationTargetType,
    targetId: string,
    decision?: ModerationDecisionDto,
  ): Prisma.PrismaPromise<unknown> {
    return this.prisma.moderationLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        reason: decision?.reason ?? null,
        note: decision?.note ?? null,
      },
    });
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
