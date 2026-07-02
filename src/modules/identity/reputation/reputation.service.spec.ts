import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ReputationService } from './reputation.service';

describe('ReputationService', () => {
  let service: ReputationService;
  let user: { update: jest.Mock };
  let reputationEvent: { create: jest.Mock };

  beforeEach(async () => {
    user = { update: jest.fn() };
    reputationEvent = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: PrismaService, useValue: { user, reputationEvent } },
        { provide: ConfigService, useValue: { get: () => 2 } },
      ],
    }).compile();

    service = module.get(ReputationService);
  });

  it('reads the configured points for an event', () => {
    expect(service.points('offerUpvote')).toBe(2);
  });

  describe('applyWithin', () => {
    it('increments the counter and appends a ledger entry inside the tx', async () => {
      const tx = {
        user: { update: jest.fn() },
        reputationEvent: { create: jest.fn() },
      } as never;

      await service.applyWithin(tx, 'user-1', 2, {
        reason: 'offerUpvote',
        sourceType: 'offer_vote',
        sourceId: 'offer-1',
      });

      const txc = tx as unknown as {
        user: { update: jest.Mock };
        reputationEvent: { create: jest.Mock };
      };
      expect(txc.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { reputation: { increment: 2 } },
      });
      expect(txc.reputationEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          delta: 2,
          reason: 'offerUpvote',
          sourceType: 'offer_vote',
          sourceId: 'offer-1',
        },
      });
    });

    it('does nothing when the delta is zero', async () => {
      const tx = {
        user: { update: jest.fn() },
        reputationEvent: { create: jest.fn() },
      } as never;

      await service.applyWithin(tx, 'user-1', 0, {
        reason: 'offerUpvote',
        sourceType: 'offer_vote',
      });

      const txc = tx as unknown as { user: { update: jest.Mock } };
      expect(txc.user.update).not.toHaveBeenCalled();
    });
  });

  describe('entries', () => {
    it('returns the counter and ledger operations', () => {
      const ops = service.entries('user-1', -5, {
        reason: 'offerDisabled',
        sourceType: 'offer_moderation',
        sourceId: 'offer-1',
      });

      expect(ops).toHaveLength(2);
      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { reputation: { increment: -5 } },
      });
      expect(reputationEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          delta: -5,
          reason: 'offerDisabled',
          sourceType: 'offer_moderation',
          sourceId: 'offer-1',
        },
      });
    });

    it('returns no operations when the delta is zero', () => {
      expect(
        service.entries('user-1', 0, {
          reason: 'reportDismissed',
          sourceType: 'report',
        }),
      ).toEqual([]);
    });
  });
});
