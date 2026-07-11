import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';

import { MetricsTokenGuard } from './metrics-token.guard';

// Prometheus scrapes every 30s from a single IP, so the endpoint skips the
// throttler; access is gated by the static METRICS_TOKEN bearer instead.
@SkipThrottle()
@UseGuards(MetricsTokenGuard)
@Controller()
export class MetricsController extends PrometheusController {
  @Get()
  async index(@Res({ passthrough: true }) response: Response): Promise<string> {
    return super.index(response);
  }
}
