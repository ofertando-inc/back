import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';

import {
  COMMENTS_CREATED_TOTAL,
  HTTP_DURATION_BUCKETS,
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_TOTAL,
  OFFERS_CREATED_TOTAL,
  REPORTS_CREATED_TOTAL,
} from './metrics.constants';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';

// Global like PrismaModule: business services inject MetricsService without
// every domain module having to import this one.
@Global()
@Module({
  imports: [
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: HTTP_REQUESTS_TOTAL,
      help: 'Total number of HTTP requests, by method, route pattern and status.',
      labelNames: ['method', 'route', 'status'],
    }),
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION_SECONDS,
      help: 'HTTP request duration in seconds, by method, route pattern and status.',
      labelNames: ['method', 'route', 'status'],
      buckets: HTTP_DURATION_BUCKETS,
    }),
    makeCounterProvider({
      name: OFFERS_CREATED_TOTAL,
      help: 'Total number of offers created, by official flag.',
      labelNames: ['official'],
    }),
    makeCounterProvider({
      name: REPORTS_CREATED_TOTAL,
      help: 'Total number of reports created, by target type.',
      labelNames: ['target'],
    }),
    makeCounterProvider({
      name: COMMENTS_CREATED_TOTAL,
      help: 'Total number of comments created.',
    }),
    MetricsService,
  ],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('{*splat}');
  }
}
