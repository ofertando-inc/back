import { Module } from '@nestjs/common';

import { ModerationLogModule } from '../moderation/moderation-log.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminMerchantsController } from './admin-merchants.controller';
import { LocationsService } from './locations.service';
import { MerchantModerationService } from './merchant-moderation.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  imports: [PrismaModule, ModerationLogModule],
  controllers: [MerchantsController, AdminMerchantsController],
  providers: [MerchantsService, LocationsService, MerchantModerationService],
  exports: [MerchantsService, LocationsService],
})
export class MerchantsModule {}
