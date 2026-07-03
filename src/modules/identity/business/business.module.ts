import { Module } from '@nestjs/common';

import { MerchantsModule } from '../../catalog/merchants/merchants.module';
import { OffersModule } from '../../catalog/offers/offers.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

// The business account's own space (offers, addresses, stats for its brand).
@Module({
  imports: [OffersModule, MerchantsModule],
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
