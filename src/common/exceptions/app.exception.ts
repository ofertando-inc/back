import { HttpException } from '@nestjs/common';

import { ErrorKey } from './error-keys';

export type ErrorDetails = Record<string, unknown>;

export class AppException extends HttpException {
  constructor(
    public readonly key: ErrorKey,
    statusCode: number,
    public readonly details?: ErrorDetails,
  ) {
    super({ key, statusCode, details }, statusCode);
  }
}
