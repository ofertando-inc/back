import { Test, TestingModule } from '@nestjs/testing';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { LocationsService } from './locations.service';

describe('LocationsService', () => {
  let service: LocationsService;
  let location: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    location = {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: PrismaService, useValue: { location } },
      ],
    }).compile();

    service = module.get(LocationsService);
  });

  describe('findOrCreate', () => {
    it('reuses an existing location matched on merchant + address + city', async () => {
      const existing = { id: 'l1' };
      location.findFirst.mockResolvedValue(existing);

      const result = await service.findOrCreate('m1', {
        address: 'Carrera 7',
        city: 'Bogotá',
      });

      expect(location.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            merchantId: 'm1',
            address: { equals: 'Carrera 7', mode: 'insensitive' },
            city: { equals: 'Bogotá', mode: 'insensitive' },
          },
        }),
      );
      expect(result).toBe(existing);
      expect(location.create).not.toHaveBeenCalled();
    });

    it('creates a new location with null-coerced optionals', async () => {
      location.findFirst.mockResolvedValue(null);
      location.create.mockResolvedValue({ id: 'l2' });

      await service.findOrCreate('m1', { address: 'A', city: 'C' });

      expect(location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            merchantId: 'm1',
            address: 'A',
            city: 'C',
            region: null,
            latitude: null,
            longitude: null,
          },
        }),
      );
    });
  });

  describe('findForMerchant', () => {
    it('returns the location when it belongs to the merchant', async () => {
      const loc = { id: 'l1', merchantId: 'm1' };
      location.findUnique.mockResolvedValue(loc);

      await expect(service.findForMerchant('l1', 'm1')).resolves.toBe(loc);
    });

    it('throws location.not_found when missing or owned by another merchant', async () => {
      location.findUnique.mockResolvedValue({ id: 'l1', merchantId: 'other' });

      await expect(service.findForMerchant('l1', 'm1')).rejects.toMatchObject({
        key: ErrorKey.LocationNotFound,
      });
    });
  });
});
