import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { OffersService } from './offers.service';

@Module({
  imports: [PrismaModule],
  providers: [OffersService, OfferOwnerGuard],
  exports: [OffersService, OfferOwnerGuard],
})
export class OffersModule {}
