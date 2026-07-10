import { ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  HealthIndicatorResult,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

const packageVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: PrismaService;

  const healthCheckService = {
    check: jest.fn(),
  };

  const prismaIndicator = {
    pingCheck: jest.fn(),
  };

  const memoryIndicator = {
    checkHeap: jest.fn(),
  };

  const upResult: HealthCheckResult = {
    status: 'ok',
    info: { database: { status: 'up' }, memory_heap: { status: 'up' } },
    error: {},
    details: { database: { status: 'up' }, memory_heap: { status: 'up' } },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.GIT_SHA;

    healthCheckService.check.mockImplementation(
      async (indicators: HealthIndicatorFunction[]) => {
        await Promise.all(
          indicators.map((indicator) => Promise.resolve(indicator())),
        );
        return upResult;
      },
    );
    prismaIndicator.pingCheck.mockResolvedValue({
      database: { status: 'up' },
    } satisfies HealthIndicatorResult);
    memoryIndicator.checkHeap.mockResolvedValue({
      memory_heap: { status: 'up' },
    } satisfies HealthIndicatorResult);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: PrismaHealthIndicator, useValue: prismaIndicator },
        { provide: MemoryHealthIndicator, useValue: memoryIndicator },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get(HealthService);
    prismaService = module.get(PrismaService);
  });

  it('aggregates the database and memory indicators', async () => {
    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(report.details).toEqual(upResult.details);
    expect(prismaIndicator.pingCheck).toHaveBeenCalledWith(
      'database',
      prismaService,
      { timeout: 2_000 },
    );
    expect(memoryIndicator.checkHeap).toHaveBeenCalledWith(
      'memory_heap',
      512 * 1024 * 1024,
    );
  });

  it('appends the meta block to the Terminus result', async () => {
    const report = await service.check();

    expect(report.meta).toEqual({
      version: packageVersion,
      environment: 'test',
      uptime: expect.any(Number) as number,
    });
  });

  it('includes the commit when GIT_SHA is set', async () => {
    process.env.GIT_SHA = 'abc1234';

    const report = await service.check();

    expect(report.meta.commit).toBe('abc1234');
  });

  it('returns an error report with 503 details when a check fails', async () => {
    const errorResult: HealthCheckResult = {
      status: 'error',
      info: { memory_heap: { status: 'up' } },
      error: { database: { status: 'down', message: 'timeout' } },
      details: {
        database: { status: 'down', message: 'timeout' },
        memory_heap: { status: 'up' },
      },
    };
    healthCheckService.check.mockRejectedValue(
      new ServiceUnavailableException(errorResult),
    );

    const report = await service.check();

    expect(report.status).toBe('error');
    expect(report.details?.database).toEqual({
      status: 'down',
      message: 'timeout',
    });
    expect(report.meta.version).toBe(packageVersion);
  });

  it('rethrows unexpected errors', async () => {
    healthCheckService.check.mockRejectedValue(new Error('boom'));

    await expect(service.check()).rejects.toThrow('boom');
  });
});
