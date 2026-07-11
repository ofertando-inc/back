import { ExecutionContext } from '@nestjs/common';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { MetricsTokenGuard } from './metrics-token.guard';

const buildContext = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  }) as unknown as ExecutionContext;

describe('MetricsTokenGuard', () => {
  let guard: MetricsTokenGuard;

  beforeEach(() => {
    guard = new MetricsTokenGuard();
    delete process.env.METRICS_TOKEN;
  });

  afterAll(() => {
    delete process.env.METRICS_TOKEN;
  });

  it('allows access when METRICS_TOKEN is not configured', () => {
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('allows access with the matching bearer token', () => {
    process.env.METRICS_TOKEN = 'scrape-secret';

    expect(guard.canActivate(buildContext('Bearer scrape-secret'))).toBe(true);
  });

  it('rejects a missing header with auth.unauthorized', () => {
    process.env.METRICS_TOKEN = 'scrape-secret';

    try {
      guard.canActivate(buildContext());
      fail('expected an AppException');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).key).toBe(ErrorKey.AuthUnauthorized);
      expect((error as AppException).getStatus()).toBe(401);
    }
  });

  it('rejects a wrong token', () => {
    process.env.METRICS_TOKEN = 'scrape-secret';

    expect(() => guard.canActivate(buildContext('Bearer nope'))).toThrow(
      AppException,
    );
  });
});
