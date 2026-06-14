import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto';
import { merchantResponseSelect } from './merchant-response.select';
import { normalizeMerchantName } from './normalize';
import type { MerchantResponse } from './types/merchant-response.type';

const SEARCH_LIMIT = 20;

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  // Autocomplete over merchants; hides orphans (only verified ones or ones
  // already attached to an offer), verified first.
  search(query: ListMerchantsQueryDto): Promise<MerchantResponse[]> {
    const visible: Prisma.MerchantWhereInput = {
      OR: [{ verified: true }, { offers: { some: {} } }],
    };

    const where: Prisma.MerchantWhereInput = query.q
      ? {
          AND: [
            visible,
            { nameNormalized: { contains: normalizeMerchantName(query.q) } },
          ],
        }
      : visible;

    return this.prisma.merchant.findMany({
      where,
      orderBy: [{ verified: 'desc' }, { name: 'asc' }],
      take: SEARCH_LIMIT,
      select: merchantResponseSelect,
    });
  }

  async findById(id: string): Promise<MerchantResponse> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: merchantResponseSelect,
    });

    if (!merchant) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }

    return merchant;
  }

  // Find-or-create by normalized name (accent/case-insensitive). New merchants
  // start unverified; a moderator verifies the brand later.
  async findOrCreate(name: string): Promise<MerchantResponse> {
    const nameNormalized = normalizeMerchantName(name);
    const existing = await this.prisma.merchant.findFirst({
      where: { nameNormalized },
      select: merchantResponseSelect,
    });

    if (existing) {
      return existing;
    }

    return this.prisma.merchant.create({
      data: { name: name.trim(), nameNormalized },
      select: merchantResponseSelect,
    });
  }

  async assertExists(id: string): Promise<void> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!merchant) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }
  }
}
