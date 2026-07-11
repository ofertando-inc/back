import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthReport } from './types/health-report.type';

describe('HealthController', () => {
  let controller: HealthController;

  const healthService = {
    check: jest.fn(),
  };

  const buildResponse = () => {
    const status = jest.fn().mockReturnThis();
    return { status, res: { status } as unknown as Response };
  };

  const buildReport = (status: 'ok' | 'error'): HealthReport => ({
    status,
    info: {},
    error: {},
    details: { database: { status: status === 'ok' ? 'up' : 'down' } },
    meta: { version: '1.3.0', environment: 'test', uptime: 42 },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('live', () => {
    it('always answers ok without touching any dependency', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
      expect(healthService.check).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('returns the report with a 200 when every check is up', async () => {
      const report = buildReport('ok');
      healthService.check.mockResolvedValue(report);
      const { res, status } = buildResponse();

      await expect(controller.check(res)).resolves.toEqual(report);
      expect(status).toHaveBeenCalledWith(200);
    });

    it('returns the report with a 503 when a check is down', async () => {
      const report = buildReport('error');
      healthService.check.mockResolvedValue(report);
      const { res, status } = buildResponse();

      await expect(controller.check(res)).resolves.toEqual(report);
      expect(status).toHaveBeenCalledWith(503);
    });
  });
});
