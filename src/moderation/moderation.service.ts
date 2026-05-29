import { HttpStatus, Injectable } from '@nestjs/common';
import { OfferStatus, UserStatus } from '@prisma/client';

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
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import type { ReportSummary } from './types/report-summary.type';

type ReportCursor = {
  createdAt: string;
  id: string;
};

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
