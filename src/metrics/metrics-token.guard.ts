import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';

// Static bearer token for the Prometheus scraper (no JWT here). When
// METRICS_TOKEN is unset (local dev), the endpoint stays open.
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.METRICS_TOKEN;

    if (!token) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (request.headers.authorization === `Bearer ${token}`) {
      return true;
    }

    throw new AppException(ErrorKey.AuthUnauthorized, HttpStatus.UNAUTHORIZED);
  }
}
