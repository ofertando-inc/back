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
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  let location: {
    updateMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  let offer: { updateMany: jest.Mock; count: jest.Mock };
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
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    };
    location = {
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    };
    offer = { updateMany: jest.fn(), count: jest.fn() };
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

  describe('listMerchants', () => {
    it('filters by verified and normalized name, newest first, paginated', async () => {
      merchant.findMany.mockResolvedValue([]);

      const result = await service.listMerchants({
        verified: false,
        q: 'Éxito',
        limit: 20,
      });

      expect(merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { verified: false, nameNormalized: { contains: 'exito' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
      expect(result.nextCursor).toBeNull();
    });

    it('returns a cursor when there are more rows than the limit', async () => {
      merchant.findMany.mockResolvedValue([
        { id: 'm1', createdAt: new Date('2024-02-01T00:00:00Z') },
        { id: 'm2', createdAt: new Date('2024-01-01T00:00:00Z') },
      ]);

      const result = await service.listMerchants({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    });

    it('filters blocked merchants when blocked is true', async () => {
      merchant.findMany.mockResolvedValue([]);

      await service.listMerchants({ blocked: true });

      expect(merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { blockedAt: { not: null } } }),
      );
    });

    it('filters unblocked merchants when blocked is false', async () => {
      merchant.findMany.mockResolvedValue([]);

      await service.listMerchants({ blocked: false });

      expect(merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { blockedAt: null } }),
      );
    });
  });

  describe('listLocations', () => {
    it('filters by verified and merchant, including the merchant, newest first', async () => {
      location.findMany.mockResolvedValue([]);

      await service.listLocations({
        verified: false,
        merchant: 'merchant-1',
        limit: 20,
      });

      const calls = location.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: object;
        select: { merchant: unknown };
      };
      expect(call.where).toEqual({
        verified: false,
        merchantId: 'merchant-1',
      });
      expect(call.select.merchant).toEqual({
        select: { id: true, name: true },
      });
    });
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

  describe('block', () => {
    it('sets blockedAt and logs BLOCK_MERCHANT', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'm1' });
      merchant.update.mockResolvedValue({ id: 'm1', blockedAt: new Date() });

      await service.block('admin-1', 'm1', { reason: 'fraud' });

      const calls = merchant.update.mock.calls as unknown[][];
      const data = (calls[0]?.[0] as { data: { blockedAt: Date | null } }).data;
      expect(data.blockedAt).toBeInstanceOf(Date);
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.BLOCK_MERCHANT,
        ModerationTargetType.MERCHANT,
        'm1',
        { reason: 'fraud' },
      );
    });

    it('throws merchant.not_found when missing', async () => {
      merchant.findUnique.mockResolvedValue(null);

      await expect(service.block('admin-1', 'ghost', {})).rejects.toMatchObject(
        { key: ErrorKey.MerchantNotFound },
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('unblock', () => {
    it('clears blockedAt and logs UNBLOCK_MERCHANT', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'm1' });
      merchant.update.mockResolvedValue({ id: 'm1', blockedAt: null });

      await service.unblock('admin-1', 'm1', {});

      expect(merchant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { blockedAt: null },
        }),
      );
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'admin-1',
        ModerationAction.UNBLOCK_MERCHANT,
        ModerationTargetType.MERCHANT,
        'm1',
        {},
      );
    });
  });

  describe('updateMerchant', () => {
    it('renames the merchant and recomputes the normalized name', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'm1' });
      merchant.findFirst.mockResolvedValue(null);
      merchant.update.mockResolvedValue({ id: 'm1', name: 'Éxito' });

      await service.updateMerchant('m1', { name: '  Éxito ' });

      expect(merchant.findFirst).toHaveBeenCalledWith({
        where: { nameNormalized: 'exito', id: { not: 'm1' } },
        select: { id: true },
      });
      expect(merchant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { name: 'Éxito', nameNormalized: 'exito' },
        }),
      );
    });

    it('throws merchant.name_taken when another merchant has the name', async () => {
      merchant.findUnique.mockResolvedValue({ id: 'm1' });
      merchant.findFirst.mockResolvedValue({ id: 'm2' });

      await expect(
        service.updateMerchant('m1', { name: 'Éxito' }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantNameTaken });
      expect(merchant.update).not.toHaveBeenCalled();
    });

    it('throws merchant.not_found when missing', async () => {
      merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMerchant('ghost', { name: 'x' }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantNotFound });
    });
  });

  describe('updateLocation', () => {
    it('updates only provided fields and syncs offer cities when city changes', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1' });
      location.update.mockResolvedValue({ id: 'l1', city: 'Bogotá' });
      offer.updateMany.mockResolvedValue({ count: 3 });

      await service.updateLocation('l1', { city: 'Bogotá' });

      expect(location.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l1' },
          data: { city: 'Bogotá' },
        }),
      );
      expect(offer.updateMany).toHaveBeenCalledWith({
        where: { locationId: 'l1' },
        data: { city: 'Bogotá' },
      });
    });

    it('does not touch offers when city is unchanged', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1' });
      location.update.mockResolvedValue({ id: 'l1' });

      await service.updateLocation('l1', { address: 'Cra 7 #1-2' });

      expect(location.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { address: 'Cra 7 #1-2' } }),
      );
      expect(offer.updateMany).not.toHaveBeenCalled();
    });

    it('throws location.not_found when missing', async () => {
      location.findUnique.mockResolvedValue(null);

      await expect(
        service.updateLocation('ghost', { city: 'x' }),
      ).rejects.toMatchObject({ key: ErrorKey.LocationNotFound });
    });
  });

  describe('deleteLocation', () => {
    it('deletes immediately when no offers reference it', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1', merchantId: 'm1' });
      offer.count.mockResolvedValue(0);
      location.delete.mockResolvedValue({ id: 'l1' });

      await service.deleteLocation('l1');

      expect(location.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws location.in_use when offers exist and no reassignTo given', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1', merchantId: 'm1' });
      offer.count.mockResolvedValue(2);

      await expect(service.deleteLocation('l1')).rejects.toMatchObject({
        key: ErrorKey.LocationInUse,
      });
      expect(location.delete).not.toHaveBeenCalled();
    });

    it('reassigns offers then deletes when a same-merchant target is given', async () => {
      location.findUnique
        .mockResolvedValueOnce({ id: 'l1', merchantId: 'm1' })
        .mockResolvedValueOnce({ id: 'l2', merchantId: 'm1', city: 'Cali' });
      offer.count.mockResolvedValue(2);
      offer.updateMany.mockResolvedValue({ count: 2 });
      location.delete.mockResolvedValue({ id: 'l1' });

      await service.deleteLocation('l1', 'l2');

      expect(offer.updateMany).toHaveBeenCalledWith({
        where: { locationId: 'l1' },
        data: { locationId: 'l2', city: 'Cali' },
      });
      expect(location.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    });

    it('throws location.not_found when the reassign target is another merchant', async () => {
      location.findUnique
        .mockResolvedValueOnce({ id: 'l1', merchantId: 'm1' })
        .mockResolvedValueOnce({ id: 'l2', merchantId: 'other', city: 'Cali' });
      offer.count.mockResolvedValue(2);

      await expect(service.deleteLocation('l1', 'l2')).rejects.toMatchObject({
        key: ErrorKey.LocationNotFound,
      });
      expect(location.delete).not.toHaveBeenCalled();
    });
  });
});
