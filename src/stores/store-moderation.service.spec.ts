import { Test, TestingModule } from '@nestjs/testing';
import { ModerationAction, ModerationTargetType } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { StoreModerationService } from './store-moderation.service';

describe('StoreModerationService', () => {
  let service: StoreModerationService;
  let store: {
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  let offer: { updateMany: jest.Mock };
  let moderationLog: { entry: jest.Mock };
  let prisma: {
    store: typeof store;
    offer: typeof offer;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    store = {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    offer = { updateMany: jest.fn() };
    moderationLog = {
      entry: jest.fn().mockReturnValue(Promise.resolve('log')),
    };
    prisma = {
      store,
      offer,
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationLogService, useValue: moderationLog },
      ],
    }).compile();

    service = module.get(StoreModerationService);
  });

  describe('verify', () => {
    it('marks the store verified and logs VERIFY_STORE', async () => {
      store.findUnique.mockResolvedValue({ id: 'store-1' });
      store.update.mockResolvedValue({ id: 'store-1', verified: true });

      const result = await service.verify('admin-1', 'store-1', {
        reason: 'looks legit',
      });

      expect(store.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'store-1' },
          data: { verified: true },
        }),
      );
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.VERIFY_STORE,
        ModerationTargetType.STORE,
        'store-1',
        { reason: 'looks legit' },
      );
      expect(result).toEqual({ id: 'store-1', verified: true });
    });

    it('throws store.not_found when the store is missing', async () => {
      store.findUnique.mockResolvedValue(null);

      await expect(
        service.verify('admin-1', 'ghost', {}),
      ).rejects.toMatchObject({ key: ErrorKey.StoreNotFound });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('merge', () => {
    it('reassigns offers, deletes the source, logs MERGE_STORE and returns the target', async () => {
      store.findUnique.mockResolvedValue({ id: 'x' });
      offer.updateMany.mockResolvedValue({ count: 3 });
      store.delete.mockResolvedValue({ id: 'source-1' });
      store.findUniqueOrThrow.mockResolvedValue({
        id: 'target-1',
        name: 'Acme',
      });

      const result = await service.merge('admin-1', {
        sourceId: 'source-1',
        targetId: 'target-1',
      });

      expect(offer.updateMany).toHaveBeenCalledWith({
        where: { storeId: 'source-1' },
        data: { storeId: 'target-1' },
      });
      expect(store.delete).toHaveBeenCalledWith({ where: { id: 'source-1' } });
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.MERGE_STORE,
        ModerationTargetType.STORE,
        'target-1',
        { reason: undefined, note: 'merged from source-1' },
      );
      expect(result).toEqual({ id: 'target-1', name: 'Acme' });
    });

    it('throws store.merge_invalid when source and target are the same', async () => {
      await expect(
        service.merge('admin-1', { sourceId: 'a', targetId: 'a' }),
      ).rejects.toMatchObject({ key: ErrorKey.StoreMergeInvalid });
      expect(store.findUnique).not.toHaveBeenCalled();
    });

    it('throws store.not_found when a side does not exist', async () => {
      store.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'target-1' });

      await expect(
        service.merge('admin-1', { sourceId: 'ghost', targetId: 'target-1' }),
      ).rejects.toMatchObject({ key: ErrorKey.StoreNotFound });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
