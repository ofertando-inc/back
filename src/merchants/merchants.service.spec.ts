import { Test, TestingModule } from '@nestjs/testing';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantsService } from './merchants.service';

describe('MerchantsService', () => {
  let service: MerchantsService;
  let merchant: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    merchant = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: PrismaService, useValue: { merchant } },
      ],
    }).compile();

    service = module.get(MerchantsService);
  });

  const visible = { OR: [{ verified: true }, { offers: { some: {} } }] };

  describe('search', () => {
    it('combines orphan-hiding with a normalized name filter when q is provided', async () => {
      merchant.findMany.mockResolvedValue([]);

      await service.search({ q: 'Éxito' });

      expect(merchant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [visible, { nameNormalized: { contains: 'exito' } }] },
          orderBy: [{ verified: 'desc' }, { name: 'asc' }],
          take: 20,
        }),
      );
    });

    it('hides orphan merchants when q is absent', async () => {
      merchant.findMany.mockResolvedValue([]);

      await service.search({});

      const calls = merchant.findMany.mock.calls as unknown[][];
      expect((calls[0]?.[0] as { where: object }).where).toEqual(visible);
    });
  });

  describe('findById', () => {
    it('returns the merchant when it exists', async () => {
      const row = { id: 'm1', name: 'Acme', verified: true };
      merchant.findUnique.mockResolvedValue(row);

      await expect(service.findById('m1')).resolves.toBe(row);
    });

    it('throws merchant.not_found when missing', async () => {
      merchant.findUnique.mockResolvedValue(null);

      await expect(service.findById('ghost')).rejects.toMatchObject({
        key: ErrorKey.MerchantNotFound,
      });
    });
  });

  describe('findOrCreate', () => {
    it('reuses an existing merchant matched on the normalized name', async () => {
      const existing = { id: 'm1', name: 'Éxito' };
      merchant.findFirst.mockResolvedValue(existing);

      const result = await service.findOrCreate('  ÉXITO ');

      expect(merchant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { nameNormalized: 'exito' } }),
      );
      expect(result).toBe(existing);
      expect(merchant.create).not.toHaveBeenCalled();
    });

    it('creates a new unverified merchant when none matches', async () => {
      merchant.findFirst.mockResolvedValue(null);
      merchant.create.mockResolvedValue({ id: 'm2' });

      await service.findOrCreate('  Amazon ');

      expect(merchant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Amazon', nameNormalized: 'amazon' },
        }),
      );
    });
  });

  describe('assertExists', () => {
    it('throws merchant.not_found when missing', async () => {
      merchant.findUnique.mockResolvedValue(null);

      await expect(service.assertExists('ghost')).rejects.toMatchObject({
        key: ErrorKey.MerchantNotFound,
      });
    });
  });
});
