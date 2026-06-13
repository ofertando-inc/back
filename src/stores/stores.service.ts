import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import { storeResponseSelect } from './store-response.select';
import type { StoreResponse } from './types/store-response.type';

// Cap on autocomplete results: enough to populate a dropdown without paginating.
const SEARCH_LIMIT = 20;

@Injectable()
export class StoresService {
  private readonly storeSelect = storeResponseSelect;

  constructor(private readonly prisma: PrismaService) {}

  // Autocomplete over existing stores; verified stores surface first.
  search(query: ListStoresQueryDto): Promise<StoreResponse[]> {
    // Hide orphan stores from the picker: only verified ones, or ones already
    // attached to at least one offer, are suggested. Keeps unverified stores
    // created during an abandoned offer form out of the autocomplete.
    const visible: Prisma.StoreWhereInput = {
      OR: [{ verified: true }, { offers: { some: {} } }],
    };

    const where: Prisma.StoreWhereInput = query.q
      ? {
          AND: [
            visible,
            {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { city: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : visible;

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

  // Find-or-create: reuse an existing store with the same name + city
  // (case-insensitive) instead of creating a duplicate when several users
  // geocode the same place during the offer form. New stores start unverified;
  // a moderator verifies them later.
  async create(userId: string, dto: CreateStoreDto): Promise<StoreResponse> {
    const existing = await this.prisma.store.findFirst({
      where: {
        name: { equals: dto.name, mode: 'insensitive' },
        city: { equals: dto.city, mode: 'insensitive' },
      },
      select: this.storeSelect,
    });

    if (existing) {
      return existing;
    }

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
