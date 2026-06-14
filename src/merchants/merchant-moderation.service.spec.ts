import { Test, TestingModule } from '@nestjs/testing';
import { ModerationAction, ModerationTargetType } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantModerationService } from './merchant-moderation.service';

describe('MerchantModerationService', () => {
  let service: MerchantModerationService;
  let merchant: {
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  let location: {
    updateMany: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  let offer: { updateMany: jest.Mock };
  let moderationLog: { entry: jest.Mock };
  let prisma: {
    merchant: typeof merchant;
    location: typeof location;
    offer: typeof offer;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    merchant = {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    location = {
      updateMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    };
    offer = { updateMany: jest.fn() };
    moderationLog = {
      entry: jest.fn().mockReturnValue(Promise.resolve('log')),
    };
    prisma = {
      merchant,
      location,
      offer,
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationLogService, useValue: moderationLog },
      ],
    }).compile();

    service = module.get(MerchantModerationService);
  });

  describe('verifyMerchant', () => {
    it('marks the merchant verified and logs VERIFY_MERCHANT', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'm1' });
      merchant.update.mockResolvedValue({ id: 'm1', verified: true });

      const result = await service.verifyMerchant('admin-1', 'm1', {});

      expect(merchant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { verified: true },
        }),
      );
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.VERIFY_MERCHANT,
        ModerationTargetType.MERCHANT,
        'm1',
        {},
      );
      expect(result).toEqual({ id: 'm1', verified: true });
    });

    it('throws merchant.not_found when missing', async () => {
      merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyMerchant('admin-1', 'ghost', {}),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantNotFound });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('verifyLocation', () => {
    it('marks the location verified and logs VERIFY_LOCATION', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1' });
      location.update.mockResolvedValue({ id: 'l1', verified: true });

      await service.verifyLocation('admin-1', 'l1', {});

      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.VERIFY_LOCATION,
        ModerationTargetType.LOCATION,
        'l1',
        {},
      );
    });

    it('throws location.not_found when missing', async () => {
      location.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyLocation('admin-1', 'ghost', {}),
      ).rejects.toMatchObject({ key: ErrorKey.LocationNotFound });
    });
  });

  describe('merge', () => {
    it('moves locations and offers, deletes the source, logs and returns the target', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'x' });
      location.updateMany.mockResolvedValue({ count: 2 });
      offer.updateMany.mockResolvedValue({ count: 5 });
      merchant.delete.mockResolvedValue({ id: 'source-1' });
      merchant.findUniqueOrThrow.mockResolvedValue({ id: 'target-1' });

      const result = await service.merge('admin-1', {
        sourceId: 'source-1',
        targetId: 'target-1',
      });

      expect(location.updateMany).toHaveBeenCalledWith({
        where: { merchantId: 'source-1' },
        data: { merchantId: 'target-1' },
      });
      expect(offer.updateMany).toHaveBeenCalledWith({
        where: { merchantId: 'source-1' },
        data: { merchantId: 'target-1' },
      });
      expect(merchant.delete).toHaveBeenCalledWith({
        where: { id: 'source-1' },
      });
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.MERGE_MERCHANT,
        ModerationTargetType.MERCHANT,
        'target-1',
        { reason: undefined, note: 'merged from source-1' },
      );
      expect(result).toEqual({ id: 'target-1' });
    });

    it('throws merchant.merge_invalid on a self-merge', async () => {
      await expect(
        service.merge('admin-1', { sourceId: 'a', targetId: 'a' }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantMergeInvalid });
      expect(merchant.findUnique).not.toHaveBeenCalled();
    });

    it('throws merchant.not_found when a side does not exist', async () => {
      merchant.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'target-1' });

      await expect(
        service.merge('admin-1', { sourceId: 'ghost', targetId: 'target-1' }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantNotFound });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
