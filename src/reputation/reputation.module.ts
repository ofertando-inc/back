import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ReputationService } from './reputation.service';

@Module({
  imports: [PrismaModule],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
