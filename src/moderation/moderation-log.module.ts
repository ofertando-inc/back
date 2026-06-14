import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ModerationLogService } from './moderation-log.service';

// Standalone so any domain performing admin actions (moderation, merchants…)
// can record log entries without importing the whole ModerationModule.
@Module({
  imports: [PrismaModule],
  providers: [ModerationLogService],
  exports: [ModerationLogService],
})
export class ModerationLogModule {}
