import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OffersModule } from '../offers/offers.module';
import { AdminOffersController } from './admin-offers.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminUsersController } from './admin-users.controller';
import { ModerationService } from './moderation.service';

@Module({
  imports: [OffersModule, AuthModule],
  controllers: [
    AdminOffersController,
    AdminUsersController,
    AdminReportsController,
  ],
  providers: [ModerationService],
})
export class ModerationModule {}
