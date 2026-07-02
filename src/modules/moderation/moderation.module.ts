import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { OffersModule } from '../catalog/offers/offers.module';
import { ReputationModule } from '../identity/reputation/reputation.module';
import { AdminCommentsController } from './admin-comments.controller';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminOffersController } from './admin-offers.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminUsersController } from './admin-users.controller';
import { ModerationLogModule } from './moderation-log.module';
import { ModerationService } from './moderation.service';

// Moderation domain: admin decisions over the other domains and their audit
// log. Single feature, so the feature module doubles as the domain module.
@Module({
  imports: [OffersModule, AuthModule, ModerationLogModule, ReputationModule],
  controllers: [
    AdminOffersController,
    AdminUsersController,
    AdminReportsController,
    AdminCommentsController,
    AdminModerationController,
  ],
  providers: [ModerationService],
})
export class ModerationModule {}
