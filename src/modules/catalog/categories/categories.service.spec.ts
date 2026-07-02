import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let category: { findMany: jest.Mock };

  beforeEach(async () => {
    category = { findMany: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: { category } },
      ],
    }).compile();

    service = module.get(CategoriesService);
  });

  it('lists categories ordered by order then name', async () => {
    const rows = [
      { id: 'c1', slug: 'technology', name: 'Technology', order: 1 },
      { id: 'c2', slug: 'home', name: 'Home', order: 2 },
    ];
    category.findMany.mockResolvedValue(rows);

    const result = await service.list();

    expect(category.findMany).toHaveBeenCalledWith({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, order: true },
    });
    expect(result).toBe(rows);
  });
});
