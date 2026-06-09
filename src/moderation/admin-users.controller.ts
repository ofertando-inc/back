import {
  Body,
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
import type { PublicUser } from '../users/types/public-user.type';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { ModerationService } from './moderation.service';
import type { AdminUserDetail } from './types/admin-user-detail.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  list(
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResult<PublicUser>> {
    return this.moderationService.listUsers(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminUserDetail> {
    return this.moderationService.getUserDetail(id);
  }

  @Patch(':id/disable')
  disable(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
    @Body() decision: ModerationDecisionDto,
  ): Promise<PublicUser> {
    return this.moderationService.disableUser(id, admin.id, decision);
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
    @Body() decision: ModerationDecisionDto,
  ): Promise<PublicUser> {
    return this.moderationService.restoreUser(id, admin.id, decision);
  }
}
