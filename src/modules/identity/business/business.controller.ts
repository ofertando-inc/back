import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentMerchant } from '../../../common/decorators/current-merchant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BusinessGuard } from '../../../common/guards/business.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { LocationResponse } from '../../catalog/merchants/types/location-response.type';
import type { OfferResponse } from '../../catalog/offers/types/offer-response.type';
import type { PublicUser } from '../users/types/public-user.type';
import { BusinessService } from './business.service';
import { CreateBusinessLocationDto } from './dto/create-business-location.dto';
import { CreateBusinessOfferDto } from './dto/create-business-offer.dto';
import type { BusinessMe } from './types/business-me.type';
import type { BusinessStats } from './types/business-stats.type';
import type { OwnedMerchant } from './types/business-request.type';

@UseGuards(JwtAuthGuard, BusinessGuard)
@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Get('me')
  me(
    @CurrentUser() user: PublicUser,
    @CurrentMerchant() merchant: OwnedMerchant,
  ): Promise<BusinessMe> {
    return this.businessService.getMe(user, merchant.id);
  }

  @Post('offers')
  createOffer(
    @CurrentUser() user: PublicUser,
    @CurrentMerchant() merchant: OwnedMerchant,
    @Body() dto: CreateBusinessOfferDto,
  ): Promise<OfferResponse> {
    return this.businessService.createOffer(user.id, merchant.id, dto);
  }

  @Post('locations')
  requestLocation(
    @CurrentMerchant() merchant: OwnedMerchant,
    @Body() dto: CreateBusinessLocationDto,
  ): Promise<LocationResponse> {
    return this.businessService.requestLocation(merchant.id, dto);
  }

  @Get('stats')
  stats(@CurrentMerchant() merchant: OwnedMerchant): Promise<BusinessStats> {
    return this.businessService.getStats(merchant.id);
  }
}
