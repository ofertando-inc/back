import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram } from 'prom-client';

import {
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_TOTAL,
  METRICS_PATH,
} from './metrics.constants';

// Middleware rather than an interceptor so unmatched routes (404) and
// requests rejected by guards are counted too, with the final status code.
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(
    @InjectMetric(HTTP_REQUESTS_TOTAL)
    private readonly requestsTotal: Counter<string>,
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly requestDuration: Histogram<string>,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // originalUrl, not path: Express rewrites req.path relative to the
    // middleware mount point, so it never matches here.
    const pathname = req.originalUrl.split('?')[0];

    if (pathname === METRICS_PATH) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      // The route pattern (/offers/:id) keeps the label cardinality bounded;
      // it is only resolved by the router once the request was matched.
      const { route } = req as unknown as { route?: { path?: string } };
      const labels = {
        method: req.method,
        route: typeof route?.path === 'string' ? route.path : 'unmatched',
        status: String(res.statusCode),
      };
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

      this.requestsTotal.inc(labels);
      this.requestDuration.observe(labels, seconds);
    });

    next();
  }
}
