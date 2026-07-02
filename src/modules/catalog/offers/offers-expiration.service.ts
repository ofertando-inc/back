import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OfferStatus } from '@prisma/client';
import ms, { StringValue } from 'ms';

import { PrismaService } from '../../../prisma/prisma.service';

const INTERVAL_NAME = 'offer-expiration';
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class OffersExpirationService implements OnModuleInit {
  private readonly logger = new Logger(OffersExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get<boolean>('offerExpiration.enabled')) {
      this.logger.log('Offer expiration job disabled');
      return;
    }

    const intervalMs = this.resolveIntervalMs();
    const interval = setInterval(() => {
      void this.expireOutdatedOffers();
    }, intervalMs);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, interval);

    this.logger.log(
      `Offer expiration job scheduled every ${this.configService.get<string>('offerExpiration.interval') ?? '1h'}`,
    );
  }

  async expireOutdatedOffers(): Promise<number> {
    const result = await this.prisma.offer.updateMany({
      where: {
        status: OfferStatus.ACTIVE,
        endDate: { lt: new Date() },
      },
      data: { status: OfferStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} outdated offer(s)`);
    }

    return result.count;
  }

  private resolveIntervalMs(): number {
    const value = this.configService.get<string>('offerExpiration.interval');
    if (!value) {
      return DEFAULT_INTERVAL_MS;
    }
    const parsed = ms(value as StringValue);
    return typeof parsed === 'number' && parsed > 0
      ? parsed
      : DEFAULT_INTERVAL_MS;
  }
}
