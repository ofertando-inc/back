import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListOffersQueryDto } from '../offers/dto/list-offers-query.dto';
import { OffersExpirationService } from '../offers/offers-expiration.service';
import type { OfferResponse } from '../offers/types/offer-response.type';
import type { PublicUser } from '../users/types/public-user.type';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationService } from './moderation.service';
import type { OfferReportDetail } from './types/report-detail.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/offers')
export class AdminOffersController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly offersExpirationService: OffersExpirationService,
  ) {}

  @Get()
  list(
    @CurrentUser() admin: PublicUser,
    @Query() query: ListOffersQueryDto,
  ): Promise<PaginatedResult<OfferResponse>> {
    return this.moderationService.listOffers(query, admin.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('expire-now')
  async expireNow(): Promise<{ expired: number }> {
    const expired = await this.offersExpirationService.expireOutdatedOffers();
    return { expired };
  }

  @Patch(':id/disable')
  disable(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
  ): Promise<OfferResponse> {
    return this.moderationService.disableOffer(id, admin.id);
  }

  @Patch(':id/dismiss')
  dismiss(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
  ): Promise<OfferResponse> {
    return this.moderationService.dismissOfferReports(id, admin.id);
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
  ): Promise<OfferResponse> {
    return this.moderationService.restoreOffer(id, admin.id);
  }

  @Get(':id/reports')
  reports(
    @Param('id') id: string,
    @Query() query: ListReportsQueryDto,
  ): Promise<PaginatedResult<OfferReportDetail>> {
    return this.moderationService.listOfferReports(id, query);
  }
}
