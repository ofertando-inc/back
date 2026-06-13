import { Module } from '@nestjs/common';

import { ModerationModule } from '../moderation/moderation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminStoresController } from './admin-stores.controller';
import { GeocodingService } from './geocoding.service';
import { StoreModerationService } from './store-moderation.service';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  imports: [PrismaModule, ModerationModule],
  controllers: [StoresController, AdminStoresController],
  providers: [StoresService, GeocodingService, StoreModerationService],
  exports: [StoresService],
})
export class StoresModule {}
