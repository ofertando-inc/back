import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';

import {
  HTTP_REQUEST_DURATION_SECONDS,
  HTTP_REQUESTS_TOTAL,
} from './metrics.constants';
import { MetricsMiddleware } from './metrics.middleware';

type FakeResponse = Response & {
  statusCode: number;
  finish: () => void;
};

const buildRequest = (
  overrides: Partial<{
    originalUrl: string;
    method: string;
    route: unknown;
  }> = {},
): Request =>
  ({
    originalUrl: '/offers/some-uuid?utm=x',
    method: 'GET',
    route: { path: '/offers/:id' },
    ...overrides,
  }) as unknown as Request;

const buildResponse = (statusCode = 200): FakeResponse => {
  const emitter = new EventEmitter();
  const res = emitter as unknown as FakeResponse;
  res.statusCode = statusCode;
  res.finish = () => emitter.emit('finish');
  return res;
};

describe('MetricsMiddleware', () => {
  let middleware: MetricsMiddleware;

  const requestsTotal = { inc: jest.fn() };
  const requestDuration = { observe: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsMiddleware,
        { provide: getToken(HTTP_REQUESTS_TOTAL), useValue: requestsTotal },
        {
          provide: getToken(HTTP_REQUEST_DURATION_SECONDS),
          useValue: requestDuration,
        },
      ],
    }).compile();

    middleware = module.get(MetricsMiddleware);
  });

  it('records the route pattern, not the raw URL', () => {
    const req = buildRequest();
    const res = buildResponse(200);
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);
    res.finish();

    const labels = {
      method: 'GET',
      route: '/offers/:id',
      status: '200',
    };
    expect(next).toHaveBeenCalled();
    expect(requestsTotal.inc).toHaveBeenCalledWith(labels);
    expect(requestDuration.observe).toHaveBeenCalledWith(
      labels,
      expect.any(Number),
    );
  });

  it('labels unmatched requests when the router resolved no route', () => {
    const req = buildRequest({ originalUrl: '/nope', route: undefined });
    const res = buildResponse(404);
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);
    res.finish();

    expect(requestsTotal.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: 'unmatched',
      status: '404',
    });
  });

  it('does not count the /metrics endpoint itself', () => {
    const req = buildRequest({
      originalUrl: '/metrics',
      route: { path: '/metrics' },
    });
    const res = buildResponse(200);
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);
    res.finish();

    expect(next).toHaveBeenCalled();
    expect(requestsTotal.inc).not.toHaveBeenCalled();
    expect(requestDuration.observe).not.toHaveBeenCalled();
  });

  it('records nothing before the response finishes', () => {
    const req = buildRequest();
    const res = buildResponse(200);

    middleware.use(req, res, jest.fn());

    expect(requestsTotal.inc).not.toHaveBeenCalled();
  });
});
