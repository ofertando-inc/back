import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListOffersQueryDto } from '../offers/dto/list-offers-query.dto';
import type { OfferResponse } from '../offers/types/offer-response.type';
import type { PublicUser } from '../users/types/public-user.type';
import { ModerationService } from './moderation.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/offers')
export class AdminOffersController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  list(
    @CurrentUser() admin: PublicUser,
    @Query() query: ListOffersQueryDto,
  ): Promise<PaginatedResult<OfferResponse>> {
    return this.moderationService.listOffers(query, admin.id);
  }

  @Patch(':id/disable')
  disable(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
  ): Promise<OfferResponse> {
    return this.moderationService.disableOffer(id, admin.id);
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
  ): Promise<OfferResponse> {
    return this.moderationService.restoreOffer(id, admin.id);
  }
}
