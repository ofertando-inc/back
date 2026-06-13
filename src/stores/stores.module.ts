import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { GeocodingService } from './geocoding.service';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  imports: [PrismaModule],
  controllers: [StoresController],
  providers: [StoresService, GeocodingService],
  exports: [StoresService],
})
export class StoresModule {}
