import { Test, TestingModule } from '@nestjs/testing';
import { Offer, OfferStatus, Vote, VoteType } from '@prisma/client';

import { ErrorKey } from '../../../common/exceptions/error-keys';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReputationService } from '../../identity/reputation/reputation.service';
import { VotesService } from './votes.service';

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
    viewCount: 0,
    clickCount: 0,
    official: false,
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

function buildVote(overrides: Partial<Vote> = {}): Vote {
  return {
    id: 'vote-1',
    type: VoteType.UP,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'user-1',
    offerId: 'offer-1',
    ...overrides,
  };
}

type PrismaOfferMock = {
  findUnique: jest.Mock;
  update: jest.Mock;
};

type PrismaVoteMock = {
  findUnique: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

describe('VotesService', () => {
  let service: VotesService;
  let offer: PrismaOfferMock;
  let vote: PrismaVoteMock;
  let reputation: { points: jest.Mock; applyWithin: jest.Mock };
  let prisma: {
    offer: PrismaOfferMock;
    vote: PrismaVoteMock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    offer = { findUnique: jest.fn(), update: jest.fn() };
    vote = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    reputation = {
      points: jest.fn().mockReturnValue(2),
      applyWithin: jest.fn(),
    };
    prisma = {
      offer,
      vote,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VotesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReputationService, useValue: reputation },
      ],
    }).compile();

    service = module.get(VotesService);
  });

  describe('cast', () => {
    it('creates an UP vote and increments the score by 1', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer({ score: 6 }));

      const result = await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(vote.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', offerId: 'offer-1', type: VoteType.UP },
      });
      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { increment: 1 } },
      });
      expect(result).toEqual({ score: 6, userVote: VoteType.UP });
    });

    it('creates a DOWN vote and decrements the score by 1', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer({ score: 4 }));

      const result = await service.cast('user-1', 'offer-1', VoteType.DOWN);

      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { increment: -1 } },
      });
      expect(result).toEqual({ score: 4, userVote: VoteType.DOWN });
    });

    it('is a no-op when the user re-casts the same vote', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.UP }));

      const result = await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(vote.create).not.toHaveBeenCalled();
      expect(vote.update).not.toHaveBeenCalled();
      expect(offer.update).not.toHaveBeenCalled();
      expect(result).toEqual({ score: 5, userVote: VoteType.UP });
    });

    it('switches UP to DOWN with a -2 score delta', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.UP }));
      offer.update.mockResolvedValue(buildOffer({ score: 3 }));

      const result = await service.cast('user-1', 'offer-1', VoteType.DOWN);

      expect(vote.update).toHaveBeenCalledWith({
        where: { id: 'vote-1' },
        data: { type: VoteType.DOWN },
      });
      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { increment: -2 } },
      });
      expect(result).toEqual({ score: 3, userVote: VoteType.DOWN });
    });

    it('switches DOWN to UP with a +2 score delta', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.DOWN }));
      offer.update.mockResolvedValue(buildOffer({ score: 7 }));

      const result = await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { increment: 2 } },
      });
      expect(result).toEqual({ score: 7, userVote: VoteType.UP });
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      offer.findUnique.mockResolvedValue(null);

      await expect(
        service.cast('user-1', 'missing', VoteType.UP),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it('throws offer.not_found when the offer is DELETED', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED }),
      );

      await expect(
        service.cast('user-1', 'offer-1', VoteType.UP),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([OfferStatus.REPORTED, OfferStatus.DISABLED, OfferStatus.EXPIRED])(
      'throws vote.offer_not_voteable when the offer status is %s',
      async (status) => {
        offer.findUnique.mockResolvedValue(buildOffer({ status }));

        await expect(
          service.cast('user-1', 'offer-1', VoteType.UP),
        ).rejects.toMatchObject({ key: ErrorKey.VoteOfferNotVoteable });
      },
    );

    it('throws vote.offer_not_voteable on an ACTIVE offer past its endDate', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({
          status: OfferStatus.ACTIVE,
          endDate: new Date('2000-01-01T00:00:00Z'),
        }),
      );

      await expect(
        service.cast('user-1', 'offer-1', VoteType.UP),
      ).rejects.toMatchObject({ key: ErrorKey.VoteOfferNotVoteable });
    });

    it('runs inside a Prisma transaction', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer({ score: 6 }));

      await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rewards the offer author when a user adds an upvote', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ createdById: 'author-1' }),
      );
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer());

      await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(reputation.applyWithin).toHaveBeenCalledWith(
        prisma,
        'author-1',
        2,
        {
          reason: 'offerUpvote',
          sourceType: 'offer_vote',
          sourceId: 'offer-1',
        },
      );
    });

    it('does not touch reputation on a downvote', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ createdById: 'author-1' }),
      );
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer());

      await service.cast('user-1', 'offer-1', VoteType.DOWN);

      expect(reputation.applyWithin).not.toHaveBeenCalled();
    });

    it('does not reward self-upvotes', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ createdById: 'user-1' }));
      vote.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValue(buildOffer());

      await service.cast('user-1', 'offer-1', VoteType.UP);

      expect(reputation.applyWithin).not.toHaveBeenCalled();
    });
  });

  describe('withdraw', () => {
    it('removes an existing UP vote and decrements the score by 1', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.UP }));
      offer.update.mockResolvedValue(buildOffer({ score: 4 }));

      const result = await service.withdraw('user-1', 'offer-1');

      expect(vote.delete).toHaveBeenCalledWith({ where: { id: 'vote-1' } });
      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { decrement: 1 } },
      });
      expect(result).toEqual({ score: 4, userVote: null });
    });

    it('removes an existing DOWN vote and increments the score by 1', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.DOWN }));
      offer.update.mockResolvedValue(buildOffer({ score: 6 }));

      const result = await service.withdraw('user-1', 'offer-1');

      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { score: { decrement: -1 } },
      });
      expect(result).toEqual({ score: 6, userVote: null });
    });

    it('is idempotent when no vote exists', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ score: 5 }));
      vote.findUnique.mockResolvedValue(null);

      const result = await service.withdraw('user-1', 'offer-1');

      expect(vote.delete).not.toHaveBeenCalled();
      expect(offer.update).not.toHaveBeenCalled();
      expect(result).toEqual({ score: 5, userVote: null });
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      offer.findUnique.mockResolvedValue(null);

      await expect(service.withdraw('user-1', 'missing')).rejects.toMatchObject(
        { key: ErrorKey.OfferNotFound },
      );
    });

    it('throws vote.offer_not_voteable when the offer status is REPORTED', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.REPORTED }),
      );

      await expect(service.withdraw('user-1', 'offer-1')).rejects.toMatchObject(
        { key: ErrorKey.VoteOfferNotVoteable },
      );
    });

    it('takes back the author reward when an upvote is removed', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ createdById: 'author-1' }),
      );
      vote.findUnique.mockResolvedValue(buildVote({ type: VoteType.UP }));
      offer.update.mockResolvedValue(buildOffer());

      await service.withdraw('user-1', 'offer-1');

      expect(reputation.applyWithin).toHaveBeenCalledWith(
        prisma,
        'author-1',
        -2,
        {
          reason: 'offerUpvote',
          sourceType: 'offer_vote',
          sourceId: 'offer-1',
        },
      );
    });
  });

  describe('findUserVote', () => {
    it('returns the vote when one exists', async () => {
      const existing = buildVote();
      vote.findUnique.mockResolvedValue(existing);

      await expect(service.findUserVote('user-1', 'offer-1')).resolves.toBe(
        existing,
      );
      expect(vote.findUnique).toHaveBeenCalledWith({
        where: { userId_offerId: { userId: 'user-1', offerId: 'offer-1' } },
      });
    });

    it('returns null when no vote exists', async () => {
      vote.findUnique.mockResolvedValue(null);

      await expect(
        service.findUserVote('user-1', 'offer-1'),
      ).resolves.toBeNull();
    });
  });

  describe('findByUser', () => {
    const offerSelect = {
      offer: { select: { id: true, title: true, score: true } },
    };

    it('filters by user, skips deleted offers, and maps the offer context', async () => {
      vote.findMany.mockResolvedValue([
        {
          ...buildVote({
            type: VoteType.UP,
            createdAt: new Date('2024-06-02T00:00:00Z'),
          }),
          offer: { id: 'offer-1', title: 'A deal', score: 3 },
        },
      ]);

      const result = await service.findByUser('user-1', {});

      expect(vote.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          offer: { status: { not: OfferStatus.DELETED } },
        },
        include: offerSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      });
      expect(result.items).toEqual([
        {
          type: VoteType.UP,
          createdAt: new Date('2024-06-02T00:00:00Z'),
          offer: { id: 'offer-1', title: 'A deal', score: 3 },
        },
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('returns a cursor when there are more results than the limit', async () => {
      vote.findMany.mockResolvedValue([
        {
          ...buildVote({
            id: 'vote-1',
            createdAt: new Date('2024-06-02T00:00:00Z'),
          }),
          offer: { id: 'offer-1', title: 'A', score: 1 },
        },
        {
          ...buildVote({
            id: 'vote-2',
            createdAt: new Date('2024-06-01T00:00:00Z'),
          }),
          offer: { id: 'offer-2', title: 'B', score: 1 },
        },
      ]);

      const result = await service.findByUser('user-1', { limit: 1 });

      expect(vote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    });
  });
});
