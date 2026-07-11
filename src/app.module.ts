import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { authConfig } from './config/auth.config';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { commentReportConfig } from './config/comment-report.config';
import { geocodingConfig } from './config/geocoding.config';
import { offerExpirationConfig } from './config/offer-expiration.config';
import { reportConfig } from './config/report.config';
import { reputationConfig } from './config/reputation.config';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommunityModule } from './modules/community/community.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        authConfig,
        reportConfig,
        offerExpirationConfig,
        commentReportConfig,
        geocodingConfig,
        reputationConfig,
      ],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    HealthModule,
    MetricsModule,
    IdentityModule,
    CatalogModule,
    CommunityModule,
    ModerationModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
