import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Comment,
  CommentReportReason,
  Offer,
  OfferStatus,
  Report,
  ReportReason,
  ReportStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { RefreshTokensService } from '../identity/auth/refresh-tokens.service';
import { ErrorKey } from '../../common/exceptions/error-keys';
import { encodeCursor } from '../../common/pagination/cursor.helper';
import { ListOffersQueryDto } from '../catalog/offers/dto/list-offers-query.dto';
import { OffersService } from '../catalog/offers/offers.service';
import type { OfferResponse } from '../catalog/offers/types/offer-response.type';
import { PrismaService } from '../../prisma/prisma.service';
import { ReputationService } from '../identity/reputation/reputation.service';
import { ModerationLogService } from './moderation-log.service';
import type { PublicUser } from '../identity/users/types/public-user.type';
import { ModerationService } from './moderation.service';

type CommentWithRelations = Comment & {
  user: { id: string; username: string };
  offer: { id: string; title: string };
};

function buildModerationComment(
  overrides: Partial<CommentWithRelations> = {},
): CommentWithRelations {
  return {
    id: 'comment-1',
    content: 'reported comment',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
    score: 0,
    replyCount: 0,
    reportCount: 5,
    userId: 'author-1',
    offerId: 'offer-1',
    parentId: null,
    replyToId: null,
    user: { id: 'author-1', username: 'author' },
    offer: { id: 'offer-1', title: 'Title' },
    ...overrides,
  };
}

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    title: 'Title',
    description: 'Description',
    offerType: 'discount',
    externalUrl: null,
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
    createdById: 'author-1',
    merchantId: 'merchant-1',
    locationId: null,
    isOnline: false,
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
    reputation: 0,
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
    categories: [],
    merchant: {
      id: 'merchant-1',
      name: 'Acme',
      verified: false,
      blocked: false,
    },
    location: null,
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
    status: ReportStatus.PENDING,
    createdAt: new Date('2024-06-01T00:00:00Z'),
    resolvedAt: null,
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
    offer: { findUnique: jest.Mock; update: jest.Mock; count: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    report: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    comment: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    commentReport: {
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    moderationLog: { findMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let offersService: jest.Mocked<Pick<OffersService, 'findAll' | 'findById'>>;
  let refreshTokensService: jest.Mocked<
    Pick<RefreshTokensService, 'revokeAllForUser'>
  >;
  let reputation: { points: jest.Mock; entries: jest.Mock };
  let commentThreshold = 3;

  beforeEach(async () => {
    commentThreshold = 3;
    prisma = {
      offer: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      report: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      comment: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      commentReport: {
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      moderationLog: { findMany: jest.fn(), create: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    prisma.report.findMany.mockResolvedValue([]);
    prisma.commentReport.findMany.mockResolvedValue([]);
    offersService = {
      findAll: jest.fn(),
      findById: jest.fn(),
    };
    refreshTokensService = {
      revokeAllForUser: jest.fn(),
    };
    reputation = {
      points: jest.fn().mockReturnValue(0),
      entries: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        ModerationLogService,
        { provide: PrismaService, useValue: prisma },
        { provide: OffersService, useValue: offersService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => commentThreshold) },
        },
        { provide: ReputationService, useValue: reputation },
      ],
    }).compile();

    service = module.get(ModerationService);
  });

  describe('listOffers', () => {
    it('delegates to OffersService.findAll with admin: true', async () => {
      const query = { limit: 20 } as ListOffersQueryDto;
      const expected = { items: [], nextCursor: null, total: 0 };
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

      const result = await service.disableOffer('offer-1', 'admin-1', {
        reason: 'scam',
      });

      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: {
          status: OfferStatus.DISABLED,
          disabledAt: expect.any(Date) as unknown as Date,
          reportCount: 0,
        },
      });
      // pending reports are resolved
      expect(prisma.report.updateMany).toHaveBeenCalledWith({
        where: { offerId: 'offer-1', status: ReportStatus.PENDING },
        data: {
          status: ReportStatus.RESOLVED,
          resolvedAt: expect.any(Date) as unknown as Date,
        },
      });
      // the decision is recorded in the moderation log
      expect(prisma.moderationLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'admin-1',
          action: 'DISABLE_OFFER',
          targetType: 'OFFER',
          targetId: 'offer-1',
          reason: 'scam',
          note: null,
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

    it('penalizes the author and rewards each reporter', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ createdById: 'author-1' }),
      );
      prisma.report.findMany.mockResolvedValue([{ userId: 'reporter-1' }]);
      offersService.findById.mockResolvedValue(buildOfferResponse());

      await service.disableOffer('offer-1', 'admin-1');

      expect(reputation.entries).toHaveBeenCalledWith('author-1', 0, {
        reason: 'offerDisabled',
        sourceType: 'offer_moderation',
        sourceId: 'offer-1',
      });
      expect(reputation.entries).toHaveBeenCalledWith('reporter-1', 0, {
        reason: 'reportResolved',
        sourceType: 'report',
        sourceId: 'offer-1',
      });
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

  describe('dismissOfferReports', () => {
    it('dismisses pending reports and returns a REPORTED offer to ACTIVE', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.REPORTED, reportCount: 4 }),
      );
      const enriched = buildOfferResponse({ status: OfferStatus.ACTIVE });
      offersService.findById.mockResolvedValue(enriched);

      const result = await service.dismissOfferReports('offer-1', 'admin-1');

      expect(prisma.report.updateMany).toHaveBeenCalledWith({
        where: { offerId: 'offer-1', status: ReportStatus.PENDING },
        data: {
          status: ReportStatus.DISMISSED,
          resolvedAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { reportCount: 0, status: OfferStatus.ACTIVE },
      });
      expect(result).toBe(enriched);
    });

    it('clears reports on an EXPIRED offer without changing its status', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.EXPIRED, reportCount: 2 }),
      );
      offersService.findById.mockResolvedValue(buildOfferResponse());

      await service.dismissOfferReports('offer-1', 'admin-1');

      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { reportCount: 0 },
      });
    });

    it('throws offer.not_found when the offer is missing or deleted', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED, reportCount: 3 }),
      );

      await expect(
        service.dismissOfferReports('offer-1', 'admin-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it('throws offer.invalid_status_transition when there is nothing to dismiss', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.ACTIVE, reportCount: 0 }),
      );

      await expect(
        service.dismissOfferReports('offer-1', 'admin-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferInvalidStatusTransition });
      expect(prisma.report.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('restoreOffer', () => {
    it('re-activates a DISABLED offer, keeping its reports as history', async () => {
      prisma.offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DISABLED, reportCount: 0 }),
      );
      const enriched = buildOfferResponse({ status: OfferStatus.ACTIVE });
      offersService.findById.mockResolvedValue(enriched);

      const result = await service.restoreOffer('offer-1', 'admin-1');

      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { status: OfferStatus.ACTIVE, disabledAt: null, reportCount: 0 },
      });
      expect(prisma.report.deleteMany).not.toHaveBeenCalled();
      expect(result).toBe(enriched);
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      prisma.offer.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreOffer('missing', 'admin-1'),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([
      OfferStatus.ACTIVE,
      OfferStatus.REPORTED,
      OfferStatus.DELETED,
      OfferStatus.EXPIRED,
    ])(
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
      const call = calls[0]?.[0] as {
        where: { status: string; AND: { OR: unknown[] }[] };
      };
      // only pending reports, plus the cursor predicate
      expect(call.where.status).toBe('PENDING');
      expect(call.where.AND[0].OR).toHaveLength(2);
    });
  });

  describe('listCommentReports', () => {
    it('returns the report details for a comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(buildModerationComment());
      prisma.commentReport.findMany.mockResolvedValue([
        {
          id: 'cr1',
          reason: CommentReportReason.SPAM,
          note: 'looks like an ad',
          status: ReportStatus.PENDING,
          createdAt: new Date('2024-06-01T00:00:00Z'),
          user: { id: 'u1', username: 'reporter' },
        },
      ]);

      const result = await service.listCommentReports('comment-1', {
        limit: 5,
      });

      const calls = prisma.commentReport.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { where: { commentId: string } };
      expect(call.where.commentId).toBe('comment-1');
      expect(result.items[0]).toMatchObject({
        id: 'cr1',
        reason: CommentReportReason.SPAM,
        note: 'looks like an ad',
        status: ReportStatus.PENDING,
        user: { id: 'u1', username: 'reporter' },
      });
      expect(result.nextCursor).toBeNull();
    });

    it('throws comment.not_found when the comment is missing', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.listCommentReports('missing', {}),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });
  });

  describe('listOfferReports', () => {
    it('returns the report details for an offer (comment text mapped to note)', async () => {
      prisma.offer.findUnique.mockResolvedValue(buildOffer());
      prisma.report.findMany.mockResolvedValue([
        buildReport({ id: 'r1', comment: 'scammy link' }),
      ]);

      const result = await service.listOfferReports('offer-1', { limit: 5 });

      const calls = prisma.report.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { where: { offerId: string } };
      expect(call.where.offerId).toBe('offer-1');
      expect(result.items[0]).toMatchObject({
        id: 'r1',
        reason: ReportReason.SCAM,
        note: 'scammy link',
        user: { id: 'user-1', username: 'reporter' },
      });
    });

    it('throws offer.not_found when the offer is missing', async () => {
      prisma.offer.findUnique.mockResolvedValue(null);

      await expect(
        service.listOfferReports('missing', {}),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });
  });

  describe('getModerationSummary', () => {
    it('counts the pending comment queue and pending offer reports', async () => {
      prisma.comment.count.mockResolvedValue(4);
      prisma.report.count.mockResolvedValue(7);

      const result = await service.getModerationSummary();

      // comment queue: above threshold, live and not hidden
      expect(prisma.comment.count).toHaveBeenCalledWith({
        where: {
          reportCount: { gte: 3 },
          hiddenAt: null,
          deletedAt: null,
        },
      });
      // offer reports: only PENDING ones
      expect(prisma.report.count).toHaveBeenCalledWith({
        where: { status: ReportStatus.PENDING },
      });
      expect(result).toEqual({ pendingComments: 4, pendingOfferReports: 7 });
    });
  });

  describe('listModerationLog', () => {
    it('returns paginated moderation log entries with their actor', async () => {
      prisma.moderationLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          action: 'HIDE_COMMENT',
          targetType: 'COMMENT',
          targetId: 'comment-1',
          reason: 'spam',
          note: null,
          createdAt: new Date('2024-06-02T00:00:00Z'),
          actor: { id: 'admin-1', username: 'admin' },
        },
      ]);

      const result = await service.listModerationLog({ limit: 5 });

      expect(result.items[0]).toMatchObject({
        id: 'log-1',
        action: 'HIDE_COMMENT',
        targetType: 'COMMENT',
        targetId: 'comment-1',
        reason: 'spam',
        actor: { id: 'admin-1', username: 'admin' },
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns a nextCursor when more entries exist', async () => {
      const entry = (id: string) => ({
        id,
        action: 'HIDE_COMMENT',
        targetType: 'COMMENT',
        targetId: 'c',
        reason: null,
        note: null,
        createdAt: new Date('2024-06-02T00:00:00Z'),
        actor: { id: 'admin-1', username: 'admin' },
      });
      prisma.moderationLog.findMany.mockResolvedValue([
        entry('l1'),
        entry('l2'),
        entry('l3'),
      ]);

      const result = await service.listModerationLog({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('listUsers', () => {
    it('searches by username/email and paginates', async () => {
      prisma.user.findMany.mockResolvedValue([buildPublicUser({ id: 'u1' })]);

      const result = await service.listUsers({ search: 'bob', limit: 5 });

      const calls = prisma.user.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as { where: { OR: unknown[] } };
      expect(call.where.OR).toEqual([
        { username: { contains: 'bob', mode: 'insensitive' } },
        { email: { contains: 'bob', mode: 'insensitive' } },
      ]);
      expect(result.items[0]).toMatchObject({ id: 'u1' });
      expect(result.nextCursor).toBeNull();
    });

    it('returns a nextCursor when more users exist', async () => {
      prisma.user.findMany.mockResolvedValue([
        buildPublicUser({ id: 'u1' }),
        buildPublicUser({ id: 'u2' }),
        buildPublicUser({ id: 'u3' }),
      ]);

      const result = await service.listUsers({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('getUserDetail', () => {
    it('returns the user with content counts and moderation history', async () => {
      prisma.user.findUnique.mockResolvedValue(buildPublicUser({ id: 'u1' }));
      prisma.$transaction.mockResolvedValueOnce([
        3,
        12,
        [
          {
            id: 'log-1',
            action: 'DISABLE_USER',
            targetType: 'USER',
            targetId: 'u1',
            reason: 'abuse',
            note: null,
            createdAt: new Date('2024-06-02T00:00:00Z'),
            actor: { id: 'admin-1', username: 'admin' },
          },
        ],
      ]);

      const result = await service.getUserDetail('u1');

      expect(result).toMatchObject({
        id: 'u1',
        counts: { offers: 3, comments: 12 },
      });
      expect(result.moderationHistory[0]).toMatchObject({
        action: 'DISABLE_USER',
        targetId: 'u1',
        reason: 'abuse',
        actor: { username: 'admin' },
      });
    });

    it('throws user.not_found when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserDetail('missing')).rejects.toMatchObject({
        key: ErrorKey.UserNotFound,
      });
    });
  });

  describe('disableUser', () => {
    it('transitions ACTIVE user to DISABLED and revokes all sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(buildPublicUser());
      const updated = buildPublicUser({ status: UserStatus.DISABLED });
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.disableUser('user-1', 'admin-1', {
        reason: 'repeated abuse',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.DISABLED },
        select: expect.any(Object) as unknown as object,
      });
      // the decision is recorded in the moderation log
      expect(prisma.moderationLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'admin-1',
          action: 'DISABLE_USER',
          targetType: 'USER',
          targetId: 'user-1',
          reason: 'repeated abuse',
          note: null,
        },
      });
      expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result).toBe(updated);
    });

    it('throws user.not_found when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.disableUser('missing', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.UserNotFound,
      });
      expect(refreshTokensService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('throws user.invalid_status_transition when the user is already DISABLED', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildPublicUser({ status: UserStatus.DISABLED }),
      );

      await expect(
        service.disableUser('user-1', 'admin-1'),
      ).rejects.toMatchObject({
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

      const result = await service.restoreUser('user-1', 'admin-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.ACTIVE },
        select: expect.any(Object) as unknown as object,
      });
      expect(result).toBe(updated);
    });

    it('throws user.not_found when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreUser('missing', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.UserNotFound,
      });
    });

    it('throws user.invalid_status_transition when the user is already ACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValue(buildPublicUser());

      await expect(
        service.restoreUser('user-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.UserInvalidStatusTransition,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('listReportedComments', () => {
    it('queries live, non-hidden comments above the threshold, most-reported first', async () => {
      prisma.comment.findMany.mockResolvedValue([
        buildModerationComment({ id: 'c1', reportCount: 8 }),
      ]);

      const result = await service.listReportedComments({ limit: 5 });

      const calls = prisma.comment.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: { reportCount: unknown; hiddenAt: null; deletedAt: null };
        orderBy: unknown;
      };
      expect(call.where).toMatchObject({
        reportCount: { gte: 3 },
        hiddenAt: null,
        deletedAt: null,
      });
      expect(call.orderBy).toEqual([
        { reportCount: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(result.items[0]).toMatchObject({
        id: 'c1',
        reportCount: 8,
        user: { id: 'author-1', username: 'author' },
        offer: { id: 'offer-1', title: 'Title' },
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns a composite reportCount cursor when more items exist', async () => {
      prisma.comment.findMany.mockResolvedValue([
        buildModerationComment({ id: 'c1', reportCount: 9 }),
        buildModerationComment({ id: 'c2', reportCount: 7 }),
        buildModerationComment({ id: 'c3', reportCount: 5 }),
      ]);

      const result = await service.listReportedComments({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('hideComment', () => {
    it('stamps hiddenAt and returns the summary', async () => {
      prisma.comment.findUnique
        .mockResolvedValueOnce(buildModerationComment())
        .mockResolvedValueOnce(
          buildModerationComment({
            hiddenAt: new Date('2024-06-02T00:00:00Z'),
          }),
        );

      const result = await service.hideComment('comment-1', 'admin-1', {
        reason: 'spam',
        note: 'obvious ad',
      });

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: {
          hiddenAt: expect.any(Date) as unknown as Date,
          reportCount: 0,
        },
      });
      // the pending reports become RESOLVED
      expect(prisma.commentReport.updateMany).toHaveBeenCalledWith({
        where: { commentId: 'comment-1', status: ReportStatus.PENDING },
        data: {
          status: ReportStatus.RESOLVED,
          resolvedAt: expect.any(Date) as unknown as Date,
        },
      });
      // a hidden comment stops counting toward the offer commentCount
      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { decrement: 1 } },
      });
      // the decision is recorded in the moderation log
      expect(prisma.moderationLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'admin-1',
          action: 'HIDE_COMMENT',
          targetType: 'COMMENT',
          targetId: 'comment-1',
          reason: 'spam',
          note: 'obvious ad',
        },
      });
      expect(result.id).toBe('comment-1');
      expect(result.hiddenAt).not.toBeNull();
    });

    it('also decrements the root replyCount when hiding a reply', async () => {
      prisma.comment.findUnique
        .mockResolvedValueOnce(
          buildModerationComment({ id: 'reply-1', parentId: 'root-1' }),
        )
        .mockResolvedValueOnce(
          buildModerationComment({
            id: 'reply-1',
            parentId: 'root-1',
            hiddenAt: new Date(),
          }),
        );

      await service.hideComment('reply-1', 'admin-1');

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'root-1' },
        data: { replyCount: { decrement: 1 } },
      });
    });

    it('throws comment.not_found when the comment is missing or author-deleted', async () => {
      prisma.comment.findUnique.mockResolvedValue(
        buildModerationComment({ deletedAt: new Date() }),
      );

      await expect(
        service.hideComment('comment-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentNotFound,
      });
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });

    it('throws comment.invalid_status_transition when already hidden', async () => {
      prisma.comment.findUnique.mockResolvedValue(
        buildModerationComment({ hiddenAt: new Date() }),
      );

      await expect(
        service.hideComment('comment-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentInvalidStatusTransition,
      });
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });

  describe('dismissComment', () => {
    it('dismisses pending reports and clears the count, keeping the comment visible', async () => {
      prisma.comment.findUnique
        .mockResolvedValueOnce(
          buildModerationComment({ hiddenAt: null, reportCount: 5 }),
        )
        .mockResolvedValueOnce(
          buildModerationComment({ hiddenAt: null, reportCount: 0 }),
        );

      await service.dismissComment('comment-1', 'admin-1');

      expect(prisma.commentReport.updateMany).toHaveBeenCalledWith({
        where: { commentId: 'comment-1', status: ReportStatus.PENDING },
        data: {
          status: ReportStatus.DISMISSED,
          resolvedAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { reportCount: 0 },
      });
      // stays visible: no commentCount change
      expect(prisma.offer.update).not.toHaveBeenCalled();
    });

    it('throws comment.not_found when the comment is missing or author-deleted', async () => {
      prisma.comment.findUnique.mockResolvedValue(
        buildModerationComment({ deletedAt: new Date() }),
      );

      await expect(
        service.dismissComment('comment-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentNotFound,
      });
    });

    it('throws comment.invalid_status_transition when hidden or unreported', async () => {
      prisma.comment.findUnique.mockResolvedValue(
        buildModerationComment({ hiddenAt: new Date(), reportCount: 0 }),
      );

      await expect(
        service.dismissComment('comment-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentInvalidStatusTransition,
      });
      expect(prisma.commentReport.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('restoreComment', () => {
    it('un-hides a hidden comment and restores the count, keeping reports', async () => {
      prisma.comment.findUnique
        .mockResolvedValueOnce(
          buildModerationComment({ hiddenAt: new Date(), reportCount: 0 }),
        )
        .mockResolvedValueOnce(
          buildModerationComment({ hiddenAt: null, reportCount: 0 }),
        );

      const result = await service.restoreComment('comment-1', 'admin-1');

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { hiddenAt: null },
      });
      expect(prisma.offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { increment: 1 } },
      });
      // history is kept: reports are not deleted
      expect(prisma.commentReport.deleteMany).not.toHaveBeenCalled();
      expect(result.hiddenAt).toBeNull();
    });

    it('also restores the root replyCount for a hidden reply', async () => {
      prisma.comment.findUnique
        .mockResolvedValueOnce(
          buildModerationComment({
            id: 'reply-1',
            parentId: 'root-1',
            hiddenAt: new Date(),
          }),
        )
        .mockResolvedValueOnce(
          buildModerationComment({ id: 'reply-1', parentId: 'root-1' }),
        );

      await service.restoreComment('reply-1', 'admin-1');

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'root-1' },
        data: { replyCount: { increment: 1 } },
      });
    });

    it('throws comment.not_found when the comment is missing or author-deleted', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.restoreComment('missing', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentNotFound,
      });
    });

    it('throws comment.invalid_status_transition when the comment is not hidden', async () => {
      prisma.comment.findUnique.mockResolvedValue(
        buildModerationComment({ hiddenAt: null, reportCount: 0 }),
      );

      await expect(
        service.restoreComment('comment-1', 'admin-1'),
      ).rejects.toMatchObject({
        key: ErrorKey.CommentInvalidStatusTransition,
      });
      expect(prisma.comment.update).not.toHaveBeenCalled();
    });
  });
});
