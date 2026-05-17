import { HttpStatus } from '@nestjs/common';

import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';

export function encodeCursor<T extends object>(payload: T): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends object>(cursor: string): T {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw invalidCursor();
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidCursor();
  }

  return parsed as T;
}

function invalidCursor(): AppException {
  return new AppException(
    ErrorKey.PaginationInvalidCursor,
    HttpStatus.BAD_REQUEST,
  );
}
