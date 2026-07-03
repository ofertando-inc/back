import { Test, TestingModule } from '@nestjs/testing';
import { AccountType, ClaimStatus, UserRole, UserStatus } from '@prisma/client';

import { LocationsService } from '../../catalog/merchants/locations.service';
import { MerchantsService } from '../../catalog/merchants/merchants.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PublicUser } from '../users/types/public-user.type';
import { BusinessService } from './business.service';
import type { CreateBusinessOfferDto } from './dto/create-business-offer.dto';

const businessUser: PublicUser = {
  id: 'biz-1',
  email: 'biz@corp.co',
  username: 'corp',
  role: UserRole.USER,
  accountType: AccountType.BUSINESS,
  status: UserStatus.ACTIVE,
  reputation: 0,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

describe('BusinessService', () => {
  let service: BusinessService;
  let offersService: { create: jest.Mock };
  let merchantsService: { findById: jest.Mock };
  let locationsService: { findOrCreate: jest.Mock };
  let prismaOffer: { aggregate: jest.Mock; count: jest.Mock };
  let prismaClaim: { findFirst: jest.Mock };

  beforeEach(async () => {
    offersService = { create: jest.fn() };
    merchantsService = { findById: jest.fn() };
    locationsService = { findOrCreate: jest.fn() };
    prismaOffer = { aggregate: jest.fn(), count: jest.fn() };
    prismaClaim = { findFirst: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessService,
        {
          provide: PrismaService,
          useValue: { offer: prismaOffer, merchantClaim: prismaClaim },
        },
        { provide: OffersService, useValue: offersService },
        { provide: MerchantsService, useValue: merchantsService },
        { provide: LocationsService, useValue: locationsService },
      ],
    }).compile();

    service = module.get(BusinessService);
  });

  describe('createOffer', () => {
    it('forces the affiliated merchant id on the created offer', async () => {
      offersService.create.mockResolvedValue({ id: 'offer-1' });
      const dto = {
        title: 'Official promo',
        merchantId: 'spoofed-merchant',
      } as unknown as CreateBusinessOfferDto;

      await service.createOffer('biz-1', 'm1', dto);

      expect(offersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Official promo',
          merchantId: 'm1',
          merchantName: undefined,
        }),
        'biz-1',
      );
    });
  });

  describe('requestLocation', () => {
    it('creates the location for the affiliated merchant (unverified by default)', async () => {
      locationsService.findOrCreate.mockResolvedValue({
        id: 'l1',
        verified: false,
      });

      const result = await service.requestLocation('m1', {
        address: 'Carrera 7',
        city: 'Bogotá',
      });

      expect(locationsService.findOrCreate).toHaveBeenCalledWith('m1', {
        address: 'Carrera 7',
        city: 'Bogotá',
      });
      expect(result).toEqual({ id: 'l1', verified: false });
    });
  });

  describe('getMe', () => {
    it('returns the user, the merchant and the approved claim', async () => {
      merchantsService.findById.mockResolvedValue({ id: 'm1', name: 'Acme' });
      prismaClaim.findFirst.mockResolvedValue({
        id: 'c1',
        status: ClaimStatus.APPROVED,
      });

      const result = await service.getMe(businessUser, 'm1');

      expect(prismaClaim.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'biz-1', status: ClaimStatus.APPROVED },
        }),
      );
      expect(result.user).toBe(businessUser);
      expect(result.merchant).toEqual({ id: 'm1', name: 'Acme' });
      expect(result.claim).toEqual({ id: 'c1', status: ClaimStatus.APPROVED });
    });
  });

  describe('getStats', () => {
    it('aggregates counters over the merchant offers', async () => {
      prismaOffer.aggregate.mockResolvedValue({
        _count: 4,
        _sum: {
          viewCount: 120,
          clickCount: 30,
          score: 12,
          commentCount: 8,
          reportCount: 1,
        },
      });
      prismaOffer.count.mockResolvedValue(3);

      const stats = await service.getStats('m1');

      expect(stats).toEqual({
        offers: { total: 4, active: 3 },
        views: 120,
        clicks: 30,
        score: 12,
        comments: 8,
        reports: 1,
      });
    });

    it('defaults empty sums to zero', async () => {
      prismaOffer.aggregate.mockResolvedValue({
        _count: 0,
        _sum: {
          viewCount: null,
          clickCount: null,
          score: null,
          commentCount: null,
          reportCount: null,
        },
      });
      prismaOffer.count.mockResolvedValue(0);

      const stats = await service.getStats('m1');

      expect(stats).toEqual({
        offers: { total: 0, active: 0 },
        views: 0,
        clicks: 0,
        score: 0,
        comments: 0,
        reports: 0,
      });
    });
  });
});
