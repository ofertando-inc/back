import { Test, TestingModule } from '@nestjs/testing';
import { Offer, OfferStatus, Prisma, VoteType } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import {
  ListOffersQueryDto,
  OfferPeriod,
  OfferSortMode,
} from './dto/list-offers-query.dto';
import { OffersService } from './offers.service';
import type { DateCursor, ScoreCursor } from './types/offer-cursor.type';

function firstCallArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[0]?.[0] as T;
}

const objectContaining = <T extends object>(value: T): T =>
  expect.objectContaining(value) as unknown as T;

const anyOf = <T>(constructor: new (...args: never[]) => T): T =>
  expect.any(constructor) as unknown as T;

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    title: 'Title',
    description: 'A description longer than the minimum',
    offerType: 'discount',
    externalUrl: null,
    storeName: 'Store',
    city: 'Bogotá',
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2099-01-01T00:00:00Z'),
    status: OfferStatus.ACTIVE,
    score: 0,
    reportCount: 0,
    commentCount: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    disabledAt: null,
    deletedAt: null,
    createdById: 'user-1',
    ...overrides,
  };
}

type OfferWithResponseRelations = Offer & {
  createdBy: { username: string };
  votes?: { type: VoteType }[];
  categories: { id: string; slug: string; name: string }[];
};

function buildOfferWithRelations(
  overrides: Partial<Offer> = {},
  relations: {
    createdByUsername?: string;
    votes?: { type: VoteType }[];
    categories?: { id: string; slug: string; name: string }[];
  } = {},
): OfferWithResponseRelations {
  return {
    ...buildOffer(overrides),
    createdBy: { username: relations.createdByUsername ?? 'author' },
    categories: relations.categories ?? [],
    ...(relations.votes !== undefined && { votes: relations.votes }),
  };
}

type PrismaOfferMock = {
  create: jest.Mock;
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  count: jest.Mock;
  groupBy: jest.Mock;
};

describe('OffersService', () => {
  let service: OffersService;
  let prismaOffer: PrismaOfferMock;
  let prismaCategory: { count: jest.Mock; findMany: jest.Mock };

  beforeEach(async () => {
    prismaOffer = {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn(),
    };
    prismaCategory = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        {
          provide: PrismaService,
          useValue: {
            offer: prismaOffer,
            category: prismaCategory,
            $transaction: jest.fn((ops: Promise<unknown>[]) =>
              Promise.all(ops),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(OffersService);
  });

  describe('create', () => {
    const futureStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    const baseDto: CreateOfferDto = {
      title: 'Title',
      description: 'Description long enough',
      offerType: 'discount',
      externalUrl: undefined,
      storeName: 'Store',
      city: 'Bogotá',
      startDate: futureStart,
      endDate: futureEnd,
      categoryIds: ['11111111-1111-1111-1111-111111111111'],
    };

    it('persists the offer with createdById set to the caller', async () => {
      const expected = buildOfferWithRelations({
        createdById: 'user-42',
      });
      prismaOffer.create.mockResolvedValue(expected);

      const result = await service.create(baseDto, 'user-42');

      expect(prismaOffer.create).toHaveBeenCalledWith({
        data: objectContaining({
          title: baseDto.title,
          startDate: new Date(futureStart),
          endDate: new Date(futureEnd),
          createdById: 'user-42',
        }),
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
          votes: {
            where: { userId: 'user-42' },
            select: { type: true },
            take: 1,
          },
        },
      });
      expect(result).toEqual({
        ...buildOffer({ createdById: 'user-42' }),
        createdByUsername: 'author',
        userVote: null,
        categories: [],
      });
    });

    it('connects the (deduped) categories after validating they exist', async () => {
      prismaOffer.create.mockResolvedValue(buildOfferWithRelations());
      prismaCategory.count.mockResolvedValue(2);

      await service.create(
        { ...baseDto, categoryIds: ['cat-a', 'cat-b', 'cat-a'] },
        'user-1',
      );

      expect(prismaCategory.count).toHaveBeenCalledWith({
        where: { id: { in: ['cat-a', 'cat-b'] } },
      });
      const call = firstCallArg<{ data: { categories: unknown } }>(
        prismaOffer.create,
      );
      expect(call.data.categories).toEqual({
        connect: [{ id: 'cat-a' }, { id: 'cat-b' }],
      });
    });

    it('throws offer.invalid_category when a category does not exist', async () => {
      prismaCategory.count.mockResolvedValue(0);

      await expect(
        service.create({ ...baseDto, categoryIds: ['ghost'] }, 'user-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferInvalidCategory });
      expect(prismaOffer.create).not.toHaveBeenCalled();
    });

    it('throws offer.invalid_dates when startDate is after endDate', async () => {
      const dto: CreateOfferDto = {
        ...baseDto,
        startDate: futureEnd,
        endDate: futureStart,
      };

      await expect(service.create(dto, 'user-1')).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidDates,
      });
      expect(prismaOffer.create).not.toHaveBeenCalled();
    });

    it('throws offer.invalid_dates when endDate is already in the past', async () => {
      const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const dto: CreateOfferDto = {
        ...baseDto,
        startDate: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        endDate: pastEnd,
      };

      await expect(service.create(dto, 'user-1')).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidDates,
      });
    });
  });

  describe('findById', () => {
    it('queries for ACTIVE or EXPIRED by default (public viewers, expired greyed)', async () => {
      const offer = buildOfferWithRelations();
      prismaOffer.findFirst.mockResolvedValue(offer);

      await service.findById('offer-1');

      expect(prismaOffer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'offer-1',
          status: { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] },
        },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
        },
      });
    });

    it('flips an ACTIVE offer past its endDate to EXPIRED on read', async () => {
      prismaOffer.findFirst.mockResolvedValue(
        buildOfferWithRelations({
          status: OfferStatus.ACTIVE,
          endDate: new Date('2000-01-01T00:00:00Z'),
        }),
      );
      prismaOffer.update.mockResolvedValue(buildOffer());

      const result = await service.findById('offer-1');

      expect(prismaOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { status: OfferStatus.EXPIRED },
      });
      expect(result?.status).toBe(OfferStatus.EXPIRED);
    });

    it('does not flip an ACTIVE offer whose endDate is still in the future', async () => {
      prismaOffer.findFirst.mockResolvedValue(buildOfferWithRelations());

      await service.findById('offer-1');

      expect(prismaOffer.update).not.toHaveBeenCalled();
    });

    it('queries with a DELETED-exclusion filter when includeNonActive is set (admin)', async () => {
      const offer = buildOfferWithRelations({ status: OfferStatus.DISABLED });
      prismaOffer.findFirst.mockResolvedValue(offer);

      await service.findById('offer-1', undefined, { includeNonActive: true });

      expect(prismaOffer.findFirst).toHaveBeenCalledWith({
        where: { id: 'offer-1', status: { not: OfferStatus.DELETED } },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
        },
      });
    });

    it('includes the viewer vote when viewerId is provided', async () => {
      const offer = buildOfferWithRelations(
        {},
        { votes: [{ type: VoteType.UP }] },
      );
      prismaOffer.findFirst.mockResolvedValue(offer);

      const result = await service.findById('offer-1', 'viewer-1');

      expect(prismaOffer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'offer-1',
          status: { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] },
        },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
          votes: {
            where: { userId: 'viewer-1' },
            select: { type: true },
            take: 1,
          },
        },
      });
      expect(result?.userVote).toBe(VoteType.UP);
      expect(result?.createdByUsername).toBe('author');
    });

    it('returns null when not found', async () => {
      prismaOffer.findFirst.mockResolvedValue(null);
      await expect(service.findById('missing')).resolves.toBeNull();
    });
  });

  describe('findRawById', () => {
    it('queries by unique id without status filter', async () => {
      const offer = buildOffer({ status: OfferStatus.DELETED });
      prismaOffer.findUnique.mockResolvedValue(offer);

      const result = await service.findRawById('offer-1');

      expect(prismaOffer.findUnique).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
      });
      expect(result).toBe(offer);
    });
  });

  describe('update', () => {
    it('throws offer.not_found when the offer does not exist', async () => {
      prismaOffer.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {})).rejects.toMatchObject({
        key: ErrorKey.OfferNotFound,
      });
    });

    it('throws offer.invalid_status_transition when the offer is DELETED', async () => {
      prismaOffer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED }),
      );

      await expect(
        service.update('offer-1', { title: 'New' }),
      ).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidStatusTransition,
      });
    });

    it('throws offer.invalid_status_transition when the offer is EXPIRED', async () => {
      prismaOffer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.EXPIRED }),
      );

      await expect(
        service.update('offer-1', { title: 'New' }),
      ).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidStatusTransition,
      });
    });

    it('validates dates only when at least one date is provided', async () => {
      prismaOffer.findUnique.mockResolvedValue(buildOffer());
      prismaOffer.update.mockResolvedValue(
        buildOfferWithRelations({ title: 'New' }),
      );

      await service.update('offer-1', { title: 'New' });

      expect(prismaOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { title: 'New' },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
        },
      });
    });

    it('rejects updates where the merged dates are inconsistent', async () => {
      prismaOffer.findUnique.mockResolvedValue(
        buildOffer({
          startDate: new Date('2025-01-01T00:00:00Z'),
          endDate: new Date('2025-12-31T00:00:00Z'),
        }),
      );

      await expect(
        service.update('offer-1', { endDate: '2024-01-01T00:00:00Z' }),
      ).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidDates,
      });
    });

    it('applies a partial update and parses date strings', async () => {
      prismaOffer.findUnique.mockResolvedValue(buildOffer());
      prismaOffer.update.mockResolvedValue(
        buildOfferWithRelations({ title: 'Patched' }),
      );

      const result = await service.update('offer-1', {
        title: 'Patched',
        startDate: '2099-01-01T00:00:00Z',
        endDate: '2099-12-31T00:00:00Z',
      });

      expect(prismaOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: {
          title: 'Patched',
          startDate: new Date('2099-01-01T00:00:00Z'),
          endDate: new Date('2099-12-31T00:00:00Z'),
        },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
        },
      });
      expect(result.createdByUsername).toBe('author');
      expect(result.userVote).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('throws offer.not_found when the offer does not exist', async () => {
      prismaOffer.findUnique.mockResolvedValue(null);
      await expect(service.softDelete('missing')).rejects.toMatchObject({
        key: ErrorKey.OfferNotFound,
      });
    });

    it('adds a viewer-scoped vote include when viewerId is provided', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({} as ListOffersQueryDto, {
        viewerId: 'viewer-1',
      });

      expect(prismaOffer.findMany).toHaveBeenCalledWith(
        objectContaining({
          include: {
            createdBy: { select: { username: true } },
            categories: {
              select: { id: true, slug: true, name: true },
              orderBy: { order: 'asc' },
            },
            votes: {
              where: { userId: 'viewer-1' },
              select: { type: true },
              take: 1,
            },
          },
        }),
      );
    });

    it('throws offer.invalid_status_transition when already DELETED', async () => {
      prismaOffer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED }),
      );

      await expect(service.softDelete('offer-1')).rejects.toMatchObject({
        key: ErrorKey.OfferInvalidStatusTransition,
      });
    });

    it('sets status DELETED and stamps deletedAt', async () => {
      prismaOffer.findUnique.mockResolvedValue(buildOffer());
      prismaOffer.update.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED }),
      );

      await service.softDelete('offer-1');

      expect(prismaOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: objectContaining({
          status: OfferStatus.DELETED,
          deletedAt: anyOf(Date),
        }),
      });
    });
  });

  describe('findAll', () => {
    it('defaults to ACTIVE+EXPIRED status and date sort with default limit', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({} as ListOffersQueryDto);

      expect(prismaOffer.findMany).toHaveBeenCalledWith({
        where: { status: { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] } },
        include: {
          createdBy: { select: { username: true } },
          categories: {
            select: { id: true, slug: true, name: true },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      });
    });

    it('honors a custom status filter when called with admin: true', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll(
        { status: OfferStatus.REPORTED } as ListOffersQueryDto,
        { admin: true },
      );

      expect(prismaOffer.findMany).toHaveBeenCalledWith(
        objectContaining({
          where: { status: OfferStatus.REPORTED },
        }),
      );
    });

    it('ignores a status query param from anonymous callers (security)', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({
        status: OfferStatus.DELETED,
      } as ListOffersQueryDto);

      expect(prismaOffer.findMany).toHaveBeenCalledWith(
        objectContaining({
          where: { status: { in: [OfferStatus.ACTIVE, OfferStatus.EXPIRED] } },
        }),
      );
    });

    it('applies city and offerType filters', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({
        city: 'Medellín',
        offerType: 'discount',
      } as ListOffersQueryDto);

      expect(prismaOffer.findMany).toHaveBeenCalledWith(
        objectContaining({
          where: objectContaining({
            city: 'Medellín',
            offerType: 'discount',
          }),
        }),
      );
    });

    it('applies a createdAt cutoff for period=week', async () => {
      prismaOffer.findMany.mockResolvedValue([]);
      const before = Date.now();

      await service.findAll({
        period: OfferPeriod.Week,
      } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { createdAt: { gte: Date } } }>(
        prismaOffer.findMany,
      );
      const cutoff = call.where.createdAt.gte;
      const expectedCutoff = before - 7 * 24 * 3600 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedCutoff - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedCutoff + 1000);
    });

    it('omits createdAt filter when period=all', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({
        period: OfferPeriod.All,
      } as ListOffersQueryDto);

      const call = firstCallArg<{ where: Prisma.OfferWhereInput }>(
        prismaOffer.findMany,
      );
      expect(call.where.createdAt).toBeUndefined();
    });

    it('uses score-aware order when sort=score', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({
        sort: OfferSortMode.Score,
      } as ListOffersQueryDto);

      expect(prismaOffer.findMany).toHaveBeenCalledWith(
        objectContaining({
          orderBy: [{ score: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('decodes a date cursor and applies a tuple WHERE', async () => {
      prismaOffer.findMany.mockResolvedValue([]);
      const cursor = encodeCursor<DateCursor>({
        createdAt: '2024-06-01T00:00:00Z',
        id: 'offer-99',
      });

      await service.findAll({ cursor } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { AND: { OR: unknown[] }[] } }>(
        prismaOffer.findMany,
      );
      expect(call.where.AND[0].OR).toEqual([
        { createdAt: { lt: new Date('2024-06-01T00:00:00Z') } },
        { createdAt: new Date('2024-06-01T00:00:00Z'), id: { lt: 'offer-99' } },
      ]);
    });

    it('decodes a score cursor and applies a three-tier tuple WHERE', async () => {
      prismaOffer.findMany.mockResolvedValue([]);
      const cursor = encodeCursor<ScoreCursor>({
        score: 42,
        createdAt: '2024-06-01T00:00:00Z',
        id: 'offer-99',
      });

      await service.findAll({
        cursor,
        sort: OfferSortMode.Score,
      } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { AND: { OR: unknown[] }[] } }>(
        prismaOffer.findMany,
      );
      expect(call.where.AND[0].OR).toHaveLength(3);
    });

    it('returns nextCursor=null when there are no more items', async () => {
      prismaOffer.findMany.mockResolvedValue([buildOfferWithRelations()]);

      const result = await service.findAll({ limit: 5 } as ListOffersQueryDto);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toMatchObject({
        createdByUsername: 'author',
        userVote: null,
      });
    });

    it('returns a nextCursor encoding the last item when there are more', async () => {
      const items = Array.from({ length: 3 }, (_, i) =>
        buildOfferWithRelations({
          id: `offer-${i + 1}`,
          createdAt: new Date(2024, 0, i + 1),
        }),
      );
      prismaOffer.findMany.mockResolvedValue(items);

      const result = await service.findAll({ limit: 2 } as ListOffersQueryDto);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();

      const decoded = decodeCursor<DateCursor>(result.nextCursor as string);
      expect(decoded.id).toBe('offer-2');
    });

    it('applies a free-text search over title, description and store', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({ q: 'sony' } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { OR: unknown[] } }>(
        prismaOffer.findMany,
      );
      expect(call.where.OR).toEqual([
        { title: { contains: 'sony', mode: 'insensitive' } },
        { description: { contains: 'sony', mode: 'insensitive' } },
        { storeName: { contains: 'sony', mode: 'insensitive' } },
      ]);
    });

    it('filters by store name', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({ store: 'Carrefour' } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { storeName: string } }>(
        prismaOffer.findMany,
      );
      expect(call.where.storeName).toBe('Carrefour');
    });

    it('filters by category slug', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({ category: 'technology' } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { categories: unknown } }>(
        prismaOffer.findMany,
      );
      expect(call.where.categories).toEqual({ some: { slug: 'technology' } });
    });

    it('hides expired offers from the public list when includeExpired=false', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({ includeExpired: false } as ListOffersQueryDto);

      const call = firstCallArg<{ where: { status: unknown } }>(
        prismaOffer.findMany,
      );
      expect(call.where.status).toBe(OfferStatus.ACTIVE);
    });

    it('orders by soonest-ending with sort=ending', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({
        sort: OfferSortMode.Ending,
      } as ListOffersQueryDto);

      const call = firstCallArg<{ orderBy: unknown }>(prismaOffer.findMany);
      expect(call.orderBy).toEqual([{ endDate: 'asc' }, { id: 'asc' }]);
    });

    it('returns the total count of matching offers', async () => {
      prismaOffer.findMany.mockResolvedValue([buildOfferWithRelations()]);
      prismaOffer.count.mockResolvedValue(42);

      const result = await service.findAll({} as ListOffersQueryDto);

      expect(result.total).toBe(42);
    });
  });

  describe('getFacets', () => {
    it('aggregates cities, stores and category counts over visible offers', async () => {
      prismaOffer.groupBy
        .mockResolvedValueOnce([
          { city: 'Bogotá', _count: 3 },
          { city: 'Cali', _count: 1 },
        ])
        .mockResolvedValueOnce([{ storeName: 'Acme', _count: 4 }]);
      prismaCategory.findMany.mockResolvedValue([
        { slug: 'technology', name: 'Technology', _count: { offers: 2 } },
      ]);

      const result = await service.getFacets();

      expect(result.cities).toEqual([
        { value: 'Bogotá', count: 3 },
        { value: 'Cali', count: 1 },
      ]);
      expect(result.stores).toEqual([{ value: 'Acme', count: 4 }]);
      expect(result.categories).toEqual([
        { slug: 'technology', name: 'Technology', count: 2 },
      ]);
    });
  });
});
