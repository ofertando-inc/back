import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { HealthService } from './health.service';
import { HealthReport } from './types/health-report.type';

// Public supervision endpoints: probes (Uptime Kuma, Docker healthcheck) call
// them unauthenticated, from the same IP and more often than the throttler
// allows. Nothing sensitive is exposed (component states only, no config).
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Liveness: answers as soon as the process serves requests, no dependency
  // checked. This is the Docker healthcheck target.
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness: database + memory checks, Terminus format plus a meta block.
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.healthService.check();

    res.status(
      report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return report;
  }
}
