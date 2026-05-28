import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Offer, OfferStatus, Report, ReportReason } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

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

function buildReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    reason: ReportReason.OTHER,
    comment: null,
    createdAt: new Date(),
    userId: 'user-1',
    offerId: 'offer-1',
    ...overrides,
  };
}

type PrismaOfferMock = {
  findUnique: jest.Mock;
  update: jest.Mock;
};

type PrismaReportMock = {
  findUnique: jest.Mock;
  create: jest.Mock;
};

describe('ReportsService', () => {
  let service: ReportsService;
  let offer: PrismaOfferMock;
  let report: PrismaReportMock;
  let prisma: {
    offer: PrismaOfferMock;
    report: PrismaReportMock;
    $transaction: jest.Mock;
  };
  let threshold = 3;

  beforeEach(async () => {
    threshold = 3;
    offer = { findUnique: jest.fn(), update: jest.fn() };
    report = { findUnique: jest.fn(), create: jest.fn() };
    prisma = {
      offer,
      report,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const configService = {
      get: jest.fn(() => threshold),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('create', () => {
    const dto = { reason: ReportReason.SCAM, comment: 'fishy stuff' };

    it('creates the report and increments the count without status transition below threshold', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 0 }));
      report.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValueOnce(buildOffer({ reportCount: 1 }));

      const result = await service.create('user-1', 'offer-1', dto);

      expect(report.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          offerId: 'offer-1',
          reason: ReportReason.SCAM,
          comment: 'fishy stuff',
        },
      });
      expect(offer.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: OfferStatus.ACTIVE });
    });

    it('transitions the offer to REPORTED when the threshold is reached', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 2 }));
      report.findUnique.mockResolvedValue(null);
      offer.update
        .mockResolvedValueOnce(buildOffer({ reportCount: 3 }))
        .mockResolvedValueOnce(
          buildOffer({ reportCount: 3, status: OfferStatus.REPORTED }),
        );

      const result = await service.create('user-1', 'offer-1', dto);

      expect(offer.update).toHaveBeenCalledTimes(2);
      expect(offer.update).toHaveBeenLastCalledWith({
        where: { id: 'offer-1' },
        data: { status: OfferStatus.REPORTED },
      });
      expect(result).toEqual({ status: OfferStatus.REPORTED });
    });

    it('keeps incrementing without re-transitioning when the offer is already REPORTED', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.REPORTED, reportCount: 5 }),
      );
      report.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValueOnce(
        buildOffer({ status: OfferStatus.REPORTED, reportCount: 6 }),
      );

      const result = await service.create('user-1', 'offer-1', dto);

      expect(offer.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: OfferStatus.REPORTED });
    });

    it('is idempotent when the user has already reported the offer', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 2 }));
      report.findUnique.mockResolvedValue(buildReport());

      const result = await service.create('user-1', 'offer-1', dto);

      expect(report.create).not.toHaveBeenCalled();
      expect(offer.update).not.toHaveBeenCalled();
      expect(result).toEqual({ status: OfferStatus.ACTIVE });
    });

    it('stores null comment when not provided', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 0 }));
      report.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValueOnce(buildOffer({ reportCount: 1 }));

      await service.create('user-1', 'offer-1', {
        reason: ReportReason.EXPIRED,
      });

      expect(report.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          offerId: 'offer-1',
          reason: ReportReason.EXPIRED,
          comment: null,
        },
      });
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      offer.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'missing', dto),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it('throws offer.not_found when the offer is DELETED', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.DELETED }),
      );

      await expect(
        service.create('user-1', 'offer-1', dto),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([OfferStatus.DISABLED, OfferStatus.EXPIRED])(
      'throws report.offer_not_reportable when the status is %s',
      async (status) => {
        offer.findUnique.mockResolvedValue(buildOffer({ status }));

        await expect(
          service.create('user-1', 'offer-1', dto),
        ).rejects.toMatchObject({
          key: ErrorKey.ReportOfferNotReportable,
        });
      },
    );

    it('uses the default threshold of 10 when configuration is missing', async () => {
      threshold = NaN;
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 8 }));
      report.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValueOnce(buildOffer({ reportCount: 9 }));

      const result = await service.create('user-1', 'offer-1', dto);

      expect(offer.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: OfferStatus.ACTIVE });
    });

    it('runs the work inside a Prisma transaction', async () => {
      offer.findUnique.mockResolvedValue(buildOffer({ reportCount: 0 }));
      report.findUnique.mockResolvedValue(null);
      offer.update.mockResolvedValueOnce(buildOffer({ reportCount: 1 }));

      await service.create('user-1', 'offer-1', dto);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findUserReport', () => {
    it('returns the report when one exists', async () => {
      const existing = buildReport();
      report.findUnique.mockResolvedValue(existing);

      await expect(service.findUserReport('user-1', 'offer-1')).resolves.toBe(
        existing,
      );
      expect(report.findUnique).toHaveBeenCalledWith({
        where: { userId_offerId: { userId: 'user-1', offerId: 'offer-1' } },
      });
    });

    it('returns null when no report exists', async () => {
      report.findUnique.mockResolvedValue(null);

      await expect(
        service.findUserReport('user-1', 'offer-1'),
      ).resolves.toBeNull();
    });
  });
});
