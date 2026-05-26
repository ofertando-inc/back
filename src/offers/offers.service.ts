import { HttpStatus, Injectable } from '@nestjs/common';
import { Offer, OfferStatus, Prisma, VoteType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import {
  ListOffersQueryDto,
  OfferPeriod,
  OfferSortMode,
} from './dto/list-offers-query.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import type {
  DateCursor,
  OfferCursor,
  ScoreCursor,
} from './types/offer-cursor.type';
import type { OfferResponse } from './types/offer-response.type';

const DAY_MS = 24 * 60 * 60 * 1000;

type OfferWithResponseRelations = Offer & {
  createdBy: { username: string };
  votes?: { type: VoteType }[];
};

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOfferDto, userId: string): Promise<OfferResponse> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    this.assertStartBeforeEnd(startDate, endDate);
    this.assertEndInFuture(endDate);

    const offer = await this.prisma.offer.create({
      data: {
        title: dto.title,
        description: dto.description,
        offerType: dto.offerType,
        externalUrl: dto.externalUrl,
        storeName: dto.storeName,
        city: dto.city,
        startDate,
        endDate,
        createdById: userId,
      },
      include: this.buildOfferResponseInclude(userId),
    });

    return this.toOfferResponse(offer);
  }

  async findById(id: string, viewerId?: string): Promise<OfferResponse | null> {
    const offer = await this.prisma.offer.findFirst({
      where: {
        id,
        status: { not: OfferStatus.DELETED },
      },
      include: this.buildOfferResponseInclude(viewerId),
    });

    return offer ? this.toOfferResponse(offer) : null;
  }

  findRawById(id: string): Promise<Offer | null> {
    return this.prisma.offer.findUnique({ where: { id } });
  }

  async findAll(
    query: ListOffersQueryDto,
    options: { ownerId?: string; viewerId?: string } = {},
  ): Promise<PaginatedResult<OfferResponse>> {
    const sort = query.sort ?? OfferSortMode.Date;
    const limit = query.limit ?? 20;

    const where = this.buildWhere(query, options);
    if (query.cursor) {
      const cursor = this.decodeOfferCursor(query.cursor, sort);
      Object.assign(where, { AND: [this.cursorWhere(cursor, sort)] });
    }

    const items = await this.prisma.offer.findMany({
      where,
      include: this.buildOfferResponseInclude(options.viewerId),
      orderBy: this.buildOrderBy(sort),
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((offer) => this.toOfferResponse(offer)),
      nextCursor: hasMore && last ? this.encodeCursorFor(last, sort) : null,
    };
  }

  async update(
    id: string,
    dto: UpdateOfferDto,
    viewerId?: string,
  ): Promise<OfferResponse> {
    const offer = await this.findRawById(id);

    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    if (
      offer.status === OfferStatus.DELETED ||
      offer.status === OfferStatus.EXPIRED
    ) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const startDate = dto.startDate
        ? new Date(dto.startDate)
        : offer.startDate;
      const endDate = dto.endDate ? new Date(dto.endDate) : offer.endDate;
      this.assertStartBeforeEnd(startDate, endDate);
    }

    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.offerType !== undefined && { offerType: dto.offerType }),
        ...(dto.externalUrl !== undefined && { externalUrl: dto.externalUrl }),
        ...(dto.storeName !== undefined && { storeName: dto.storeName }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.startDate !== undefined && {
          startDate: new Date(dto.startDate),
        }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      },
      include: this.buildOfferResponseInclude(viewerId),
    });

    return this.toOfferResponse(updated);
  }

  async softDelete(id: string): Promise<Offer> {
    const offer = await this.findRawById(id);

    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }

    if (offer.status === OfferStatus.DELETED) {
      throw new AppException(
        ErrorKey.OfferInvalidStatusTransition,
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.offer.update({
      where: { id },
      data: {
        status: OfferStatus.DELETED,
        deletedAt: new Date(),
      },
    });
  }

  private assertStartBeforeEnd(start: Date, end: Date): void {
    if (start.getTime() >= end.getTime()) {
      throw new AppException(
        ErrorKey.OfferInvalidDates,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertEndInFuture(end: Date): void {
    if (end.getTime() <= Date.now()) {
      throw new AppException(
        ErrorKey.OfferInvalidDates,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private buildOfferResponseInclude(viewerId?: string): Prisma.OfferInclude {
    const include: Prisma.OfferInclude = {
      createdBy: { select: { username: true } },
    };

    if (viewerId) {
      include.votes = {
        where: { userId: viewerId },
        select: { type: true },
        take: 1,
      };
    }

    return include;
  }

  private toOfferResponse(offer: OfferWithResponseRelations): OfferResponse {
    const { createdBy, votes, ...payload } = offer;

    return {
      ...payload,
      createdByUsername: createdBy.username,
      userVote: votes?.[0]?.type ?? null,
    };
  }

  private buildWhere(
    query: ListOffersQueryDto,
    options: { ownerId?: string },
  ): Prisma.OfferWhereInput {
    const where: Prisma.OfferWhereInput = {};

    if (query.status) {
      where.status = query.status;
    } else if (options.ownerId) {
      where.status = { not: OfferStatus.DELETED };
    } else {
      where.status = OfferStatus.ACTIVE;
    }

    if (options.ownerId) {
      where.createdById = options.ownerId;
    }

    if (query.city) {
      where.city = query.city;
    }
    if (query.offerType) {
      where.offerType = query.offerType;
    }

    const cutoff = this.periodCutoff(query.period ?? OfferPeriod.All);
    if (cutoff) {
      where.createdAt = { gte: cutoff };
    }

    return where;
  }

  private periodCutoff(period: OfferPeriod): Date | null {
    const now = Date.now();
    switch (period) {
      case OfferPeriod.Day:
        return new Date(now - DAY_MS);
      case OfferPeriod.Week:
        return new Date(now - 7 * DAY_MS);
      case OfferPeriod.Month:
        return new Date(now - 30 * DAY_MS);
      case OfferPeriod.Year:
        return new Date(now - 365 * DAY_MS);
      case OfferPeriod.All:
      default:
        return null;
    }
  }

  private buildOrderBy(
    sort: OfferSortMode,
  ): Prisma.OfferOrderByWithRelationInput[] {
    if (sort === OfferSortMode.Score) {
      return [{ score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
    }
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  private decodeOfferCursor(raw: string, sort: OfferSortMode): OfferCursor {
    if (sort === OfferSortMode.Score) {
      return decodeCursor<ScoreCursor>(raw);
    }
    return decodeCursor<DateCursor>(raw);
  }

  private cursorWhere(
    cursor: OfferCursor,
    sort: OfferSortMode,
  ): Prisma.OfferWhereInput {
    if (sort === OfferSortMode.Score) {
      const c = cursor as ScoreCursor;
      const createdAt = new Date(c.createdAt);
      return {
        OR: [
          { score: { lt: c.score } },
          { score: c.score, createdAt: { lt: createdAt } },
          { score: c.score, createdAt, id: { lt: c.id } },
        ],
      };
    }
    const c = cursor as DateCursor;
    const createdAt = new Date(c.createdAt);
    return {
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: c.id } }],
    };
  }

  private encodeCursorFor(offer: Offer, sort: OfferSortMode): string {
    if (sort === OfferSortMode.Score) {
      const payload: ScoreCursor = {
        score: offer.score,
        createdAt: offer.createdAt.toISOString(),
        id: offer.id,
      };
      return encodeCursor(payload);
    }
    const payload: DateCursor = {
      createdAt: offer.createdAt.toISOString(),
      id: offer.id,
    };
    return encodeCursor(payload);
  }
}
