import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import type { StoreResponse } from './types/store-response.type';

// Cap on autocomplete results: enough to populate a dropdown without paginating.
const SEARCH_LIMIT = 20;

@Injectable()
export class StoresService {
  private readonly storeSelect = {
    id: true,
    name: true,
    city: true,
    region: true,
    address: true,
    latitude: true,
    longitude: true,
    verified: true,
    createdAt: true,
  } satisfies Prisma.StoreSelect;

  constructor(private readonly prisma: PrismaService) {}

  // Autocomplete over existing stores; verified stores surface first.
  search(query: ListStoresQueryDto): Promise<StoreResponse[]> {
    const where: Prisma.StoreWhereInput = {};

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { city: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.store.findMany({
      where,
      orderBy: [{ verified: 'desc' }, { name: 'asc' }],
      take: SEARCH_LIMIT,
      select: this.storeSelect,
    });
  }

  async findById(id: string): Promise<StoreResponse> {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: this.storeSelect,
    });

    if (!store) {
      throw new AppException(ErrorKey.StoreNotFound, HttpStatus.NOT_FOUND);
    }

    return store;
  }

  // Stores created by users start unverified; a moderator verifies them later.
  create(userId: string, dto: CreateStoreDto): Promise<StoreResponse> {
    return this.prisma.store.create({
      data: {
        name: dto.name,
        city: dto.city,
        region: dto.region ?? null,
        address: dto.address ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        createdById: userId,
      },
      select: this.storeSelect,
    });
  }
}
