import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OffersModule } from '../offers/offers.module';
import { AdminCommentsController } from './admin-comments.controller';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminOffersController } from './admin-offers.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminUsersController } from './admin-users.controller';
import { ModerationLogService } from './moderation-log.service';
import { ModerationService } from './moderation.service';

@Module({
  imports: [OffersModule, AuthModule],
  controllers: [
    AdminOffersController,
    AdminUsersController,
    AdminReportsController,
    AdminCommentsController,
    AdminModerationController,
  ],
  providers: [ModerationService, ModerationLogService],
  exports: [ModerationLogService],
})
export class ModerationModule {}
