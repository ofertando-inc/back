import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [PrismaModule],
  controllers: [OffersController],
  providers: [OffersService, OfferOwnerGuard],
  exports: [OffersService, OfferOwnerGuard],
})
export class OffersModule {}
