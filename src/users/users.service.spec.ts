import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { create: jest.Mock; findUnique: jest.Mock };
    offer: { count: jest.Mock };
    comment: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn() },
      offer: { count: jest.fn() },
      comment: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getStats', () => {
    it('counts the user non-deleted offers and comments', async () => {
      prisma.offer.count.mockResolvedValue(3);
      prisma.comment.count.mockResolvedValue(7);

      const result = await service.getStats('user-1');

      expect(prisma.offer.count).toHaveBeenCalledWith({
        where: { createdById: 'user-1', status: { not: OfferStatus.DELETED } },
      });
      expect(prisma.comment.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
      });
      expect(result).toEqual({ offerCount: 3, commentCount: 7 });
    });
  });
});
