import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { CommentsModule } from './comments/comments.module';
import { authConfig } from './config/auth.config';
import { commentReportConfig } from './config/comment-report.config';
import { geocodingConfig } from './config/geocoding.config';
import { offerExpirationConfig } from './config/offer-expiration.config';
import { GeocodingModule } from './geocoding/geocoding.module';
import { MerchantsModule } from './merchants/merchants.module';
import { ModerationModule } from './moderation/moderation.module';
import { OffersModule } from './offers/offers.module';
import { PrismaModule } from './prisma/prisma.module';
import { reportConfig } from './config/report.config';
import { reputationConfig } from './config/reputation.config';
import { ReportsModule } from './reports/reports.module';
import { ReputationModule } from './reputation/reputation.module';
import { UsersModule } from './users/users.module';
import { VotesModule } from './votes/votes.module';

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
    UsersModule,
    AuthModule,
    OffersModule,
    VotesModule,
    ReportsModule,
    ModerationModule,
    CommentsModule,
    CategoriesModule,
    MerchantsModule,
    GeocodingModule,
    ReputationModule,
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
