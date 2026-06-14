import { HttpStatus, Injectable } from '@nestjs/common';
import { Offer, OfferStatus, Prisma, VoteType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import type { CountedPaginatedResult } from '../common/pagination/paginated-result.type';
import {
  LocationsService,
  type LocationInput,
} from '../merchants/locations.service';
import { MerchantsService } from '../merchants/merchants.service';
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
  EndingCursor,
  OfferCursor,
  ScoreCursor,
} from './types/offer-cursor.type';
import type { OfferFacets } from './types/offer-facets.type';
import type { OfferResponse } from './types/offer-response.type';

const DAY_MS = 24 * 60 * 60 * 1000;

// Default search radius for the "near me" filter when none is supplied.
const DEFAULT_NEAR_RADIUS_KM = 10;
const KM_PER_DEGREE_LAT = 111.32;

// Facets reflect the publicly listable offers.
const VISIBLE_OFFER = {
  status: { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] },
} satisfies Prisma.OfferWhereInput;

// Parses a "lat,lng" pair, rejecting malformed or out-of-range coordinates.
function parseNearParam(near: string): { latitude: number; longitude: number } {
  const [latRaw, lngRaw] = near.split(',');
  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new AppException(ErrorKey.OfferInvalidNear, HttpStatus.BAD_REQUEST);
  }

  return { latitude, longitude };
}

// Square bounding box (degrees) around a point for a given radius in km. A fast,
// index-friendly approximation of a circle; exact distance (Haversine/PostGIS)
// is a planned evolution.
function boundingBox(latitude: number, longitude: number, radiusKm: number) {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const lngDelta = Math.min(
    radiusKm / (KM_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180)),
    180,
  );

  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLng: longitude - lngDelta,
    maxLng: longitude + lngDelta,
  };
}

type OfferWithResponseRelations = Offer & {
  createdBy: { username: string };
  votes?: { type: VoteType }[];
  categories: { id: string; slug: string; name: string }[];
  merchant: { id: string; name: string; verified: boolean };
  location: {
    id: string;
    address: string;
    city: string;
    region: string | null;
    latitude: number | null;
    longitude: number | null;
    verified: boolean;
  } | null;
};

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantsService: MerchantsService,
    private readonly locationsService: LocationsService,
  ) {}

  async create(dto: CreateOfferDto, userId: string): Promise<OfferResponse> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    this.assertStartBeforeEnd(startDate, endDate);
    this.assertEndInFuture(endDate);
    const categoryIds = await this.resolveCategoryIds(dto.categoryIds);

    const isOnline = dto.isOnline ?? false;
    if (isOnline && !dto.externalUrl) {
      throw new AppException(
        ErrorKey.OfferOnlineRequiresUrl,
        HttpStatus.BAD_REQUEST,
      );
    }

    const merchantId = await this.resolveMerchantId(dto);
    const location = await this.resolveLocation(merchantId, dto, isOnline);

    const offer = await this.prisma.offer.create({
      data: {
        title: dto.title,
        description: dto.description,
        offerType: dto.offerType,
        externalUrl: dto.externalUrl,
        city: location?.city ?? null,
        isOnline,
        startDate,
        endDate,
        createdById: userId,
        merchantId,
        locationId: location?.id ?? null,
        categories: { connect: categoryIds.map((id) => ({ id })) },
      },
      include: this.buildOfferResponseInclude(userId),
    });

    return this.toOfferResponse(offer);
  }

  // Validates that the given category ids all exist and returns them deduped.
  private async resolveCategoryIds(categoryIds: string[]): Promise<string[]> {
    const ids = [...new Set(categoryIds)];
    const count = await this.prisma.category.count({
      where: { id: { in: ids } },
    });
    if (count !== ids.length) {
      throw new AppException(
        ErrorKey.OfferInvalidCategory,
        HttpStatus.BAD_REQUEST,
      );
    }
    return ids;
  }

  // Resolves the merchant: an existing id, or a name (find-or-create).
  private async resolveMerchantId(dto: {
    merchantId?: string;
    merchantName?: string;
  }): Promise<string> {
    if (dto.merchantId) {
      await this.merchantsService.assertExists(dto.merchantId);
      return dto.merchantId;
    }
    const merchant = await this.merchantsService.findOrCreate(
      dto.merchantName ?? '',
    );
    return merchant.id;
  }

  // Resolves the physical location for a merchant. Online offers have none;
  // physical ones need an existing location id or an inline address.
  private async resolveLocation(
    merchantId: string,
    dto: { locationId?: string; location?: LocationInput },
    isOnline: boolean,
  ): Promise<{ id: string; city: string } | null> {
    if (isOnline) {
      return null;
    }
    if (dto.locationId) {
      const location = await this.locationsService.findForMerchant(
        dto.locationId,
        merchantId,
      );
      return { id: location.id, city: location.city };
    }
    if (dto.location) {
      const location = await this.locationsService.findOrCreate(
        merchantId,
        dto.location,
      );
      return { id: location.id, city: location.city };
    }
    throw new AppException(
      ErrorKey.OfferLocationRequired,
      HttpStatus.BAD_REQUEST,
    );
  }

  async findById(
    id: string,
    viewerId?: string,
    options: { includeNonActive?: boolean } = {},
  ): Promise<OfferResponse | null> {
    const offer = await this.prisma.offer.findFirst({
      where: {
        id,
        status: options.includeNonActive
          ? { not: OfferStatus.DELETED }
          : { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] },
      },
      include: this.buildOfferResponseInclude(viewerId),
    });

    if (!offer) {
      return null;
    }

    // Flip-on-read: an ACTIVE offer past its endDate is effectively expired.
    // Persist the transition so the stored status stays accurate for hot offers,
    // while the scheduled job handles the cold ones.
    if (
      offer.status === OfferStatus.ACTIVE &&
      offer.endDate.getTime() < Date.now()
    ) {
      await this.prisma.offer.update({
        where: { id: offer.id },
        data: { status: OfferStatus.EXPIRED },
      });
      offer.status = OfferStatus.EXPIRED;
    }

    return this.toOfferResponse(offer);
  }

  findRawById(id: string): Promise<Offer | null> {
    return this.prisma.offer.findUnique({ where: { id } });
  }

  async findAll(
    query: ListOffersQueryDto,
    options: { ownerId?: string; viewerId?: string; admin?: boolean } = {},
  ): Promise<CountedPaginatedResult<OfferResponse>> {
    const sort = query.sort ?? OfferSortMode.Date;
    const limit = query.limit ?? 20;

    const where = this.buildWhere(query, options);
    // total counts the whole filtered set (the cursor predicate is excluded).
    const findWhere: Prisma.OfferWhereInput = query.cursor
      ? {
          ...where,
          AND: [
            this.cursorWhere(this.decodeOfferCursor(query.cursor, sort), sort),
          ],
        }
      : where;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where: findWhere,
        include: this.buildOfferResponseInclude(options.viewerId),
        orderBy: this.buildOrderBy(sort),
        take: limit + 1,
      }),
    ]);

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((offer) => this.toOfferResponse(offer)),
      nextCursor: hasMore && last ? this.encodeCursorFor(last, sort) : null,
      total,
    };
  }

  async getFacets(): Promise<OfferFacets> {
    // Read-only aggregates — no transaction needed; run them concurrently.
    const [cities, categories] = await Promise.all([
      this.prisma.offer.groupBy({
        by: ['city'],
        where: { ...VISIBLE_OFFER, city: { not: null } },
        _count: true,
        orderBy: { city: 'asc' },
      }),
      this.prisma.category.findMany({
        orderBy: { order: 'asc' },
        select: {
          slug: true,
          name: true,
          _count: { select: { offers: { where: VISIBLE_OFFER } } },
        },
      }),
    ]);

    return {
      cities: cities.flatMap((c) =>
        c.city === null ? [] : [{ value: c.city, count: c._count }],
      ),
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        count: c._count.offers,
      })),
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

    // Replacing the category set when provided (must keep at least one).
    const categoryIds =
      dto.categoryIds !== undefined
        ? await this.resolveCategoryIds(dto.categoryIds)
        : undefined;

    // Resulting online state (defaults to the current one when not toggled).
    const willBeOnline = dto.isOnline ?? offer.isOnline;

    if (willBeOnline) {
      const externalUrl =
        dto.externalUrl !== undefined ? dto.externalUrl : offer.externalUrl;
      if (!externalUrl) {
        throw new AppException(
          ErrorKey.OfferOnlineRequiresUrl,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Resolve the merchant only when (re)specified.
    const merchantChanged =
      dto.merchantId !== undefined || dto.merchantName !== undefined;
    const merchantId = merchantChanged
      ? await this.resolveMerchantId(dto)
      : offer.merchantId;

    // Resolve the location: cleared when online; (re)resolved when switching to
    // physical, when the merchant changes, or when a new location is supplied;
    // otherwise the current one is kept.
    let locationData: {
      locationId: string | null;
      city: string | null;
    } | null = null;
    if (willBeOnline) {
      locationData = { locationId: null, city: null };
    } else if (
      dto.locationId !== undefined ||
      dto.location !== undefined ||
      offer.isOnline ||
      merchantChanged
    ) {
      const location = await this.resolveLocation(merchantId, dto, false);
      locationData = {
        locationId: location?.id ?? null,
        city: location?.city ?? null,
      };
    }

    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.offerType !== undefined && { offerType: dto.offerType }),
        ...(dto.externalUrl !== undefined && { externalUrl: dto.externalUrl }),
        ...(dto.startDate !== undefined && {
          startDate: new Date(dto.startDate),
        }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.isOnline !== undefined && { isOnline: dto.isOnline }),
        ...(merchantChanged && { merchantId }),
        ...(locationData !== null && {
          locationId: locationData.locationId,
          city: locationData.city,
        }),
        ...(categoryIds !== undefined && {
          categories: { set: categoryIds.map((id) => ({ id })) },
        }),
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
      categories: {
        select: { id: true, slug: true, name: true },
        orderBy: { order: 'asc' },
      },
      merchant: { select: { id: true, name: true, verified: true } },
      location: {
        select: {
          id: true,
          address: true,
          city: true,
          region: true,
          latitude: true,
          longitude: true,
          verified: true,
        },
      },
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
    const { createdBy, votes, categories, merchant, location, ...payload } =
      offer;

    return {
      ...payload,
      createdByUsername: createdBy.username,
      userVote: votes?.[0]?.type ?? null,
      categories,
      merchant,
      location,
    };
  }

  private buildWhere(
    query: ListOffersQueryDto,
    options: { ownerId?: string; admin?: boolean },
  ): Prisma.OfferWhereInput {
    const where: Prisma.OfferWhereInput = {};

    if (query.status && (options.admin || options.ownerId)) {
      where.status = query.status;
    } else if (options.ownerId) {
      where.status = { not: OfferStatus.DELETED };
    } else {
      // Public listings show active and expired offers (expired ones are
      // greyed out client-side); moderation-only statuses stay hidden.
      // includeExpired=false drops the expired ones server-side.
      where.status =
        query.includeExpired === false
          ? OfferStatus.ACTIVE
          : { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] };
    }

    if (options.ownerId) {
      where.createdById = options.ownerId;
    }

    if (query.city) {
      where.city = query.city;
    }
    if (query.merchant) {
      where.merchantId = query.merchant;
    }
    if (query.offerType) {
      where.offerType = query.offerType;
    }
    if (query.category) {
      where.categories = { some: { slug: query.category } };
    }
    if (query.online !== undefined) {
      where.isOnline = query.online;
    }
    if (query.near) {
      const { latitude, longitude } = parseNearParam(query.near);
      const box = boundingBox(
        latitude,
        longitude,
        query.radiusKm ?? DEFAULT_NEAR_RADIUS_KM,
      );
      // Restrict to offers whose location sits in the box. Online offers (no
      // location) are naturally excluded.
      where.location = {
        is: {
          latitude: { gte: box.minLat, lte: box.maxLat },
          longitude: { gte: box.minLng, lte: box.maxLng },
        },
      };
    }

    if (query.q) {
      // Free-text search over title, description and merchant name.
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { merchant: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
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
    if (sort === OfferSortMode.Ending) {
      // Soonest-ending first.
      return [{ endDate: 'asc' }, { id: 'asc' }];
    }
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  private decodeOfferCursor(raw: string, sort: OfferSortMode): OfferCursor {
    if (sort === OfferSortMode.Score) {
      return decodeCursor<ScoreCursor>(raw);
    }
    if (sort === OfferSortMode.Ending) {
      return decodeCursor<EndingCursor>(raw);
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
    if (sort === OfferSortMode.Ending) {
      const c = cursor as EndingCursor;
      const endDate = new Date(c.endDate);
      return {
        OR: [{ endDate: { gt: endDate } }, { endDate, id: { gt: c.id } }],
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
    if (sort === OfferSortMode.Ending) {
      const payload: EndingCursor = {
        endDate: offer.endDate.toISOString(),
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
