import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

import { AppException, ErrorDetails } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';

interface ErrorResponseBody {
  key: ErrorKey;
  statusCode: number;
  details?: ErrorDetails;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toResponseBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }

    response.status(body.statusCode).json(body);
  }

  private toResponseBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof AppException) {
      return this.buildBody(
        exception.key,
        exception.getStatus(),
        exception.details,
      );
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return this.buildBody(
      ErrorKey.ErrorInternal,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private fromPrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ErrorResponseBody {
    switch (exception.code) {
      case 'P2002': {
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target : undefined;
        return this.buildBody(
          ErrorKey.DbUniqueViolation,
          HttpStatus.CONFLICT,
          fields ? { fields } : undefined,
        );
      }
      case 'P2025':
        return this.buildBody(ErrorKey.DbNotFound, HttpStatus.NOT_FOUND);
      default:
        return this.buildBody(
          ErrorKey.ErrorInternal,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }

  private fromHttpException(exception: HttpException): ErrorResponseBody {
    const status: HttpStatus = exception.getStatus();

    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return this.buildBody(ErrorKey.AuthUnauthorized, status);
      case HttpStatus.FORBIDDEN:
        return this.buildBody(ErrorKey.AuthForbidden, status);
      case HttpStatus.NOT_FOUND:
        return this.buildBody(ErrorKey.ErrorNotFound, status);
      case HttpStatus.TOO_MANY_REQUESTS:
        return this.buildBody(ErrorKey.ErrorTooManyRequests, status);
      case HttpStatus.BAD_REQUEST:
        return this.buildBody(ErrorKey.ErrorBadRequest, status);
      default:
        return this.buildBody(
          status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? ErrorKey.ErrorInternal
            : ErrorKey.ErrorBadRequest,
          status,
        );
    }
  }

  private buildBody(
    key: ErrorKey,
    statusCode: number,
    details?: ErrorDetails,
  ): ErrorResponseBody {
    const body: ErrorResponseBody = { key, statusCode };
    if (details !== undefined) {
      body.details = details;
    }
    return body;
  }
}
