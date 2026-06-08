import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from '../users/types/public-user.type';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { ModerationService } from './moderation.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly moderationService: ModerationService) {}

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
