import { Test, TestingModule } from '@nestjs/testing';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from './stores.service';

describe('StoresService', () => {
  let service: StoresService;
  let store: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    store = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: PrismaService, useValue: { store } },
      ],
    }).compile();

    service = module.get(StoresService);
  });

  const visible = {
    OR: [{ verified: true }, { offers: { some: {} } }],
  };

  describe('search', () => {
    it('combines the orphan-hiding filter with the text filter when q is provided', async () => {
      store.findMany.mockResolvedValue([]);

      await service.search({ q: 'acme' });

      expect(store.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              visible,
              {
                OR: [
                  { name: { contains: 'acme', mode: 'insensitive' } },
                  { city: { contains: 'acme', mode: 'insensitive' } },
                ],
              },
            ],
          },
          orderBy: [{ verified: 'desc' }, { name: 'asc' }],
          take: 20,
        }),
      );
    });

    it('hides orphan stores (only verified or already used) when q is absent', async () => {
      store.findMany.mockResolvedValue([]);

      await service.search({});

      const calls = store.findMany.mock.calls as unknown[][];
      const arg = calls[0]?.[0] as { where: object };
      expect(arg.where).toEqual(visible);
    });
  });

  describe('findById', () => {
    it('returns the store when it exists', async () => {
      const row = { id: 's1', name: 'Acme', verified: true };
      store.findUnique.mockResolvedValue(row);

      await expect(service.findById('s1')).resolves.toBe(row);
    });

    it('throws store.not_found when missing', async () => {
      store.findUnique.mockResolvedValue(null);

      await expect(service.findById('ghost')).rejects.toMatchObject({
        key: ErrorKey.StoreNotFound,
      });
    });
  });

  describe('create', () => {
    it('persists a new store as unverified with the author and null-coerced optionals', async () => {
      store.findFirst.mockResolvedValue(null);
      store.create.mockResolvedValue({ id: 's1' });

      await service.create('user-1', { name: 'Acme', city: 'Bogotá' });

      expect(store.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: { equals: 'Acme', mode: 'insensitive' },
            city: { equals: 'Bogotá', mode: 'insensitive' },
          },
        }),
      );
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Acme',
            city: 'Bogotá',
            region: null,
            address: null,
            latitude: null,
            longitude: null,
            createdById: 'user-1',
          },
        }),
      );
    });

    it('reuses an existing store with the same name and city instead of duplicating', async () => {
      const existing = { id: 's1', name: 'Acme', city: 'Bogotá' };
      store.findFirst.mockResolvedValue(existing);

      const result = await service.create('user-2', {
        name: 'Acme',
        city: 'Bogotá',
      });

      expect(result).toBe(existing);
      expect(store.create).not.toHaveBeenCalled();
    });
  });
});
