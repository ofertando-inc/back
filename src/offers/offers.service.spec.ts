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
};

function buildOfferWithRelations(
  overrides: Partial<Offer> = {},
  relations: {
    createdByUsername?: string;
    votes?: { type: VoteType }[];
  } = {},
): OfferWithResponseRelations {
  return {
    ...buildOffer(overrides),
    createdBy: { username: relations.createdByUsername ?? 'author' },
    ...(relations.votes !== undefined && { votes: relations.votes }),
  };
}

type PrismaOfferMock = {
  create: jest.Mock;
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
};

describe('OffersService', () => {
  let service: OffersService;
  let prismaOffer: PrismaOfferMock;

  beforeEach(async () => {
    prismaOffer = {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersService,
        {
          provide: PrismaService,
          useValue: { offer: prismaOffer },
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
      });
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
    it('queries with a DELETED-exclusion filter', async () => {
      const offer = buildOfferWithRelations();
      prismaOffer.findFirst.mockResolvedValue(offer);

      await service.findById('offer-1');

      expect(prismaOffer.findFirst).toHaveBeenCalledWith({
        where: { id: 'offer-1', status: { not: OfferStatus.DELETED } },
        include: { createdBy: { select: { username: true } } },
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
        where: { id: 'offer-1', status: { not: OfferStatus.DELETED } },
        include: {
          createdBy: { select: { username: true } },
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
        include: { createdBy: { select: { username: true } } },
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
        include: { createdBy: { select: { username: true } } },
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
    it('defaults to ACTIVE status and date sort with default limit', async () => {
      prismaOffer.findMany.mockResolvedValue([]);

      await service.findAll({} as ListOffersQueryDto);

      expect(prismaOffer.findMany).toHaveBeenCalledWith({
        where: { status: OfferStatus.ACTIVE },
        include: { createdBy: { select: { username: true } } },
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
          where: { status: OfferStatus.ACTIVE },
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
  });
});
