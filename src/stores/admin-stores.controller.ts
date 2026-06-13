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
import { MergeStoresDto } from './dto/merge-stores.dto';
import { StoreModerationService } from './store-moderation.service';
import type { StoreResponse } from './types/store-response.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/stores')
export class AdminStoresController {
  constructor(
    private readonly storeModerationService: StoreModerationService,
  ) {}

  @Patch(':id/verify')
  verify(
    @CurrentUser() admin: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<StoreResponse> {
    return this.storeModerationService.verify(admin.id, id, decision);
  }

  @Post('merge')
  merge(
    @CurrentUser() admin: PublicUser,
    @Body() dto: MergeStoresDto,
  ): Promise<StoreResponse> {
    return this.storeModerationService.merge(admin.id, dto);
  }
}
