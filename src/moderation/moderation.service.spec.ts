import { Test, TestingModule } from '@nestjs/testing';
import {
  Offer,
  OfferStatus,
  Report,
  ReportReason,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { RefreshTokensService } from '../auth/refresh-tokens.service';
import { ErrorKey } from '../common/exceptions/error-keys';
import { encodeCursor } from '../common/pagination/cursor.helper';
import { ListOffersQueryDto } from '../offers/dto/list-offers-query.dto';
import { OffersService } from '../offers/offers.service';
import type { OfferResponse } from '../offers/types/offer-response.type';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/types/public-user.type';
import { ModerationService } from './moderation.service';

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    title: 'Title',
    description: 'Description',
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
    createdById: 'author-1',
    ...overrides,
  };
}

function buildPublicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'user-1',
    email: 'a@b.com',
    username: 'someone',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildOfferResponse(
  overrides: Partial<OfferResponse> = {},
): OfferResponse {
  return {
    ...buildOffer(),
    createdByUsername: 'author',
    userVote: null,
    ...overrides,
  };
}

type ReportWithRelations = Report & {
  user: { id: string; username: string };
  offer: { id: string; title: string };
};

function buildReport(
  overrides: Partial<Report> = {},
  relations: Partial<ReportWithRelations> = {},
): ReportWithRelations {
  return {
    id: 'report-1',
    reason: ReportReason.SCAM,
    comment: null,
    createdAt: new Date('2024-06-01T00:00:00Z'),
    userId: 'user-1',
    offerId: 'offer-1',
    user: { id: 'user-1', username: 'reporter' },
    offer: { id: 'offer-1', title: 'Title' },
    ...overrides,
    ...relations,
  };
}

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: {
    offer: { findUnique: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
    report: { findMany: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let offersService: jest.Mocked<Pick<OffersService, 'findAll' | 'findById'>>;
  let refreshTokensService: jest.Mocked<
    Pick<RefreshTokensService, 'revokeAllForUser'>
  >;

  beforeEach(async () => {
    prisma = {
      offer: { findUnique: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      report: { findMany: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    offersService = {
      findAll: jest.fn(),
      findById: jest.fn(),
    };
    refreshTokensService = {
      revokeAllForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: OffersService, useValue: offersService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
      ],
    }).compile();

    service = module.get(ModerationService);
  });

  describe('listOffers', () => {
    it('delegates to OffersService.findAll with admin: true', async () => {
      const query = { limit: 20 } as ListOffersQueryDto;
      const expected = { items: [], nextCursor: null };
      offersService.findAll.mockResolvedValue(expected);

      const result = await service.listOffers(query, 'admin-1');

      expect(offersService.findAll).toHaveBeenCalledWith(query, {
        viewerId: 'admin-1',
        admin: true,
      });
      expect(result).toBe(expected);
    });
  });

  describe('disableOffer', () => {
    it('transitions ACTIVE offer to DISABLED and stamps disabledAt', async () => {
      prisma.offer.findUnique.mockResolvedValue(buildOffer());
      const enriched = buildOfferResponse({ status: OfferStatus.DISABLED });
      offersService.findById.mockResolvedValue(enriched);

      const result = await service.disableOffer('offer-1', 'admin-1');

      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: {
          status: OfferStatus.DISABLED,
          disabledAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(result).toBe(enriched);
    });

    it('also accepts a REPORTED offer for disabling', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.REPORTED }),
      );
      offersService.findById.mockResolvedValue(
        buildOfferResponse({ status: OfferStatus.DISABLED }),
      );

      await service.disableOffer('offer-1', 'admin-1');

      expect(prisma.offer.update).toHaveBeenCalled();
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      prisma.offer.findUnique.mockResolvedValue(null);

      await expect(
        service.disableOffer('missing', 'admin-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([OfferStatus.DISABLED, OfferStatus.DELETED, OfferStatus.EXPIRED])(
      'throws offer.invalid_status_transition when the status is %s',
      async (status) => {
        prisma.offer.findUnique.mockResolvedValue(buildOffer({ status }));

        await expect(
          service.disableOffer('offer-1', 'admin-1'),
        ).rejects.toMatchObject({
          key: ErrorKey.OfferInvalidStatusTransition,
        });
      },
    );
  });

  describe('restoreOffer', () => {
    it('transitions DISABLED offer back to ACTIVE, resets reportCount, and purges its reports', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DISABLED, reportCount: 7 }),
      );
      const enriched = buildOfferResponse({ status: OfferStatus.ACTIVE });
      offersService.findById.mockResolvedValue(enriched);

      const result = await service.restoreOffer('offer-1', 'admin-1');

      expect(prisma.report.deleteMany).toHaveBeenCalledWith({
        where: { offerId: 'offer-1' },
      });
      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: {
          status: OfferStatus.ACTIVE,
          disabledAt: null,
          reportCount: 0,
        },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBe(enriched);
    });

    it('also accepts REPORTED as a restore source', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.REPORTED, reportCount: 5 }),
      );
      offersService.findById.mockResolvedValue(buildOfferResponse());

      await service.restoreOffer('offer-1', 'admin-1');

      expect(prisma.offer.update).toHaveBeenCalled();
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      prisma.offer.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreOffer('missing', 'admin-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([OfferStatus.ACTIVE, OfferStatus.DELETED, OfferStatus.EXPIRED])(
      'throws offer.invalid_status_transition when restoring from %s',
      async (status) => {
        prisma.offer.findUnique.mockResolvedValue(buildOffer({ status }));

        await expect(
          service.restoreOffer('offer-1', 'admin-1'),
        ).rejects.toMatchObject({
          key: ErrorKey.OfferInvalidStatusTransition,
        });
      },
    );
  });

  describe('listReports', () => {
    it('returns paginated reports flattened to summaries', async () => {
      prisma.report.findMany.mockResolvedValue([
        buildReport({ id: 'r1' }),
        buildReport({ id: 'r2' }),
      ]);

      const result = await service.listReports({ limit: 5 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: 'r1',
        reason: ReportReason.SCAM,
        user: { id: 'user-1', username: 'reporter' },
        offer: { id: 'offer-1', title: 'Title' },
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when more items exist', async () => {
      prisma.report.findMany.mockResolvedValue([
        buildReport({ id: 'r1' }),
        buildReport({ id: 'r2' }),
        buildReport({ id: 'r3' }),
      ]);

      const result = await service.listReports({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });

    it('decodes the cursor and applies the WHERE clause', async () => {
      prisma.report.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        createdAt: '2024-06-01T00:00:00Z',
        id: 'report-99',
      });

      await service.listReports({ cursor });

      const calls = prisma.report.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { where: { OR: unknown[] } };
      expect(call.where.OR).toHaveLength(2);
    });
  });

  describe('disableUser', () => {
    it('transitions ACTIVE user to DISABLED and revokes all sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(buildPublicUser());
      const updated = buildPublicUser({ status: UserStatus.DISABLED });
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.disableUser('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.DISABLED },
        select: expect.any(Object) as unknown as object,
      });
      expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result).toBe(updated);
    });

    it('throws user.not_found when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.disableUser('missing')).rejects.toMatchObject({
        key: ErrorKey.UserNotFound,
      });
      expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('throws user.invalid_status_transition when the user is already DISABLED', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildPublicUser({ status: UserStatus.DISABLED }),
      );

      await expect(service.disableUser('user-1')).rejects.toMatchObject({
        key: ErrorKey.UserInvalidStatusTransition,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('restoreUser', () => {
    it('transitions DISABLED user to ACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildPublicUser({ status: UserStatus.DISABLED }),
      );
      const updated = buildPublicUser({ status: UserStatus.ACTIVE });
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.restoreUser('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.ACTIVE },
        select: expect.any(Object) as unknown as object,
      });
      expect(result).toBe(updated);
    });

    it('throws user.not_found when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.restoreUser('missing')).rejects.toMatchObject({
        key: ErrorKey.UserNotFound,
      });
    });

    it('throws user.invalid_status_transition when the user is already ACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValue(buildPublicUser());

      await expect(service.restoreUser('user-1')).rejects.toMatchObject({
        key: ErrorKey.UserInvalidStatusTransition,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
