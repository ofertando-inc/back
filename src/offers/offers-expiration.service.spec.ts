import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { OffersExpirationService } from './offers-expiration.service';

describe('OffersExpirationService', () => {
  let service: OffersExpirationService;
  let prismaOffer: { updateMany: jest.Mock };
  let schedulerRegistry: { addInterval: jest.Mock };
  let config: { enabled: boolean; interval: string };

  beforeEach(async () => {
    prismaOffer = { updateMany: jest.fn() };
    schedulerRegistry = { addInterval: jest.fn() };
    config = { enabled: false, interval: '1h' };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'offerExpiration.enabled' ? config.enabled : config.interval,
      ),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OffersExpirationService,
        { provide: PrismaService, useValue: { offer: prismaOffer } },
        { provide: ConfigService, useValue: configService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
      ],
    }).compile();

    service = module.get(OffersExpirationService);
  });

  describe('expireOutdatedOffers', () => {
    it('flips ACTIVE offers past their endDate to EXPIRED and returns the count', async () => {
      prismaOffer.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.expireOutdatedOffers();

      expect(prismaOffer.updateMany).toHaveBeenCalledWith({
        where: {
          status: OfferStatus.ACTIVE,
          endDate: { lt: expect.any(Date) as unknown as Date },
        },
        data: { status: OfferStatus.EXPIRED },
      });
      expect(count).toBe(3);
    });

    it('returns 0 when there is nothing to expire', async () => {
      prismaOffer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.expireOutdatedOffers()).resolves.toBe(0);
    });
  });

  describe('onModuleInit', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not register an interval when disabled', () => {
      config.enabled = false;

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).not.toHaveBeenCalled();
    });

    it('registers a named interval when enabled', () => {
      jest.useFakeTimers();
      config.enabled = true;
      config.interval = '30m';

      service.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'offer-expiration',
        expect.anything(),
      );

      jest.clearAllTimers();
    });

    it('triggers expiration when the scheduled interval elapses', () => {
      jest.useFakeTimers();
      config.enabled = true;
      config.interval = '1h';
      prismaOffer.updateMany.mockResolvedValue({ count: 0 });

      service.onModuleInit();
      jest.advanceTimersByTime(60 * 60 * 1000);

      expect(prismaOffer.updateMany).toHaveBeenCalledTimes(1);

      jest.clearAllTimers();
    });
  });
});
