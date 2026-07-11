import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaService } from '../prisma/prisma.service';
import { HealthMeta, HealthReport } from './types/health-report.type';

// Probes call every 30-60s; keep the database ping short so a stalled pool
// becomes a fast 503 instead of a hanging request.
const DATABASE_PING_TIMEOUT_MS = 2_000;
const HEAP_THRESHOLD_BYTES = 512 * 1024 * 1024;

@Injectable()
export class HealthService {
  private readonly version = readPackageVersion();

  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly memoryIndicator: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  async check(): Promise<HealthReport> {
    const result = await this.runChecks();

    return { ...result, meta: this.buildMeta() };
  }

  // HealthCheckService reports failures by throwing a 503; unwrap the payload
  // so the endpoint keeps the Terminus format instead of going through the
  // error-key contract of the global exception filter.
  private async runChecks(): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () =>
          this.prismaIndicator.pingCheck('database', this.prisma, {
            timeout: DATABASE_PING_TIMEOUT_MS,
          }),
        () =>
          this.memoryIndicator.checkHeap('memory_heap', HEAP_THRESHOLD_BYTES),
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return error.getResponse() as HealthCheckResult;
      }

      throw error;
    }
  }

  private buildMeta(): HealthMeta {
    const meta: HealthMeta = {
      version: this.version,
      environment: process.env.NODE_ENV ?? 'development',
      uptime: Math.round(process.uptime()),
    };

    if (process.env.GIT_SHA) {
      meta.commit = process.env.GIT_SHA;
    }

    return meta;
  }
}

// The production image keeps package.json next to dist/, so the working
// directory is the one stable place to read the deployed version from.
function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };

    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
