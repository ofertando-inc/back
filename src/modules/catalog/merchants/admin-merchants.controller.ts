import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { ModerationDecisionDto } from '../../moderation/dto/moderation-decision.dto';
import type { PublicUser } from '../../identity/users/types/public-user.type';
import { DeleteLocationQueryDto } from './dto/delete-location-query.dto';
import { ListAdminLocationsQueryDto } from './dto/list-admin-locations-query.dto';
import { ListAdminMerchantsQueryDto } from './dto/list-admin-merchants-query.dto';
import { MergeMerchantsDto } from './dto/merge-merchants.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { MerchantModerationService } from './merchant-moderation.service';
import type { AdminLocation } from './types/admin-location.type';
import type { LocationResponse } from './types/location-response.type';
import type { MerchantResponse } from './types/merchant-response.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminMerchantsController {
  constructor(
    private readonly merchantModerationService: MerchantModerationService,
  ) {}

  @Get('merchants')
  listMerchants(
    @Query() query: ListAdminMerchantsQueryDto,
  ): Promise<PaginatedResult<MerchantResponse>> {
    return this.merchantModerationService.listMerchants(query);
  }

  @Get('locations')
  listLocations(
    @Query() query: ListAdminLocationsQueryDto,
  ): Promise<PaginatedResult<AdminLocation>> {
    return this.merchantModerationService.listLocations(query);
  }

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

  @Patch('merchants/:id')
  updateMerchant(
    @Param('id') id: string,
    @Body() dto: UpdateMerchantDto,
  ): Promise<MerchantResponse> {
    return this.merchantModerationService.updateMerchant(id, dto);
  }

  @Post('merchants/:id/block')
  block(
    @CurrentUser() admin: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    return this.merchantModerationService.block(admin.id, id, decision);
  }

  @Post('merchants/:id/unblock')
  unblock(
    @CurrentUser() admin: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    return this.merchantModerationService.unblock(admin.id, id, decision);
  }

  @Patch('locations/:id')
  updateLocation(
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationResponse> {
    return this.merchantModerationService.updateLocation(id, dto);
  }

  @Delete('locations/:id')
  deleteLocation(
    @Param('id') id: string,
    @Query() query: DeleteLocationQueryDto,
  ): Promise<void> {
    return this.merchantModerationService.deleteLocation(id, query.reassignTo);
  }
}
