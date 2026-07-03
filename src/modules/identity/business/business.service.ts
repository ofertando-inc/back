import { Injectable } from '@nestjs/common';
import { ClaimStatus, OfferStatus } from '@prisma/client';

import { LocationsService } from '../../catalog/merchants/locations.service';
import { MerchantsService } from '../../catalog/merchants/merchants.service';
import { OffersService } from '../../catalog/offers/offers.service';
import type { OfferResponse } from '../../catalog/offers/types/offer-response.type';
import type { LocationResponse } from '../../catalog/merchants/types/location-response.type';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateBusinessLocationDto } from './dto/create-business-location.dto';
import { CreateBusinessOfferDto } from './dto/create-business-offer.dto';
import type { BusinessMe } from './types/business-me.type';
import type { BusinessStats } from './types/business-stats.type';

// The business account's own space: its affiliated brand, official offers,
// address-addition requests and aggregated stats. BusinessGuard guarantees an
// approved affiliation before anything here runs.
@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offersService: OffersService,
    private readonly merchantsService: MerchantsService,
    private readonly locationsService: LocationsService,
  ) {}

  async getMe(user: PublicUser, merchantId: string): Promise<BusinessMe> {
    const [merchant, claim] = await Promise.all([
      this.merchantsService.findById(merchantId),
      this.prisma.merchantClaim.findFirst({
        where: { userId: user.id, status: ClaimStatus.APPROVED },
        orderBy: { resolvedAt: 'desc' },
        select: { id: true, status: true, createdAt: true, resolvedAt: true },
      }),
    ]);

    return { user, merchant, claim };
  }

  // Publishes an offer for the affiliated brand: the merchant is forced, so
  // OffersService marks it official (author owns the merchant).
  createOffer(
    userId: string,
    merchantId: string,
    dto: CreateBusinessOfferDto,
  ): Promise<OfferResponse> {
    return this.offersService.create(
      { ...dto, merchantId, merchantName: undefined },
      userId,
    );
  }

  // Address-addition request: created unverified, it surfaces in the existing
  // admin verification queue (VERIFY_LOCATION flow).
  requestLocation(
    merchantId: string,
    dto: CreateBusinessLocationDto,
  ): Promise<LocationResponse> {
    return this.locationsService.findOrCreate(merchantId, dto);
  }

  async getStats(merchantId: string): Promise<BusinessStats> {
    const [aggregate, active] = await Promise.all([
      this.prisma.offer.aggregate({
        where: { merchantId },
        _count: true,
        _sum: {
          viewCount: true,
          clickCount: true,
          score: true,
          commentCount: true,
          reportCount: true,
        },
      }),
      this.prisma.offer.count({
        where: { merchantId, status: OfferStatus.ACTIVE },
      }),
    ]);

    return {
      offers: { total: aggregate._count, active },
      views: aggregate._sum.viewCount ?? 0,
      clicks: aggregate._sum.clickCount ?? 0,
      score: aggregate._sum.score ?? 0,
      comments: aggregate._sum.commentCount ?? 0,
      reports: aggregate._sum.reportCount ?? 0,
    };
  }
}
