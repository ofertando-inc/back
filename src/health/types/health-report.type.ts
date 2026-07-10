import { HealthCheckResult } from '@nestjs/terminus';

export type HealthMeta = {
  version: string;
  commit?: string;
  environment: string;
  uptime: number;
};

export type HealthReport = HealthCheckResult & { meta: HealthMeta };
