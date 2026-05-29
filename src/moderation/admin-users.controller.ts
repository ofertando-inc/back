import { Controller, Param, Patch, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from '../users/types/public-user.type';
import { ModerationService } from './moderation.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly moderationService: ModerationService) {}

  @Patch(':id/disable')
  disable(@Param('id') id: string): Promise<PublicUser> {
    return this.moderationService.disableUser(id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string): Promise<PublicUser> {
    return this.moderationService.restoreUser(id);
  }
}
