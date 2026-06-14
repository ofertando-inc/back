import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModerationDecisionDto } from '../moderation/dto/moderation-decision.dto';
import type { PublicUser } from '../users/types/public-user.type';
import { MergeMerchantsDto } from './dto/merge-merchants.dto';
import { MerchantModerationService } from './merchant-moderation.service';
import type { LocationResponse } from './types/location-response.type';
import type { MerchantResponse } from './types/merchant-response.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminMerchantsController {
  constructor(
    private readonly merchantModerationService: MerchantModerationService,
  ) {}

  @Patch('merchants/:id/verify')
  verifyMerchant(
    @CurrentUser() admin: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    return this.merchantModerationService.verifyMerchant(
      admin.id,
      id,
      decision,
    );
  }

  @Patch('locations/:id/verify')
  verifyLocation(
    @CurrentUser() admin: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<LocationResponse> {
    return this.merchantModerationService.verifyLocation(
      admin.id,
      id,
      decision,
    );
  }

  @Post('merchants/merge')
  merge(
    @CurrentUser() admin: PublicUser,
    @Body() dto: MergeMerchantsDto,
  ): Promise<MerchantResponse> {
    return this.merchantModerationService.merge(admin.id, dto);
  }
}
