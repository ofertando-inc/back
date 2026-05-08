import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { AppExceptionFilter } from './app-exception.filter';

describe('AppExceptionFilter', () => {
  let filter: AppExceptionFilter;
  let response: { status: jest.Mock; json: jest.Mock };
  let host: ArgumentsHost;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AppExceptionFilter();
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ArgumentsHost;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('AppException', () => {
    it('passes the exception payload through unchanged', () => {
      filter.catch(
        new AppException(
          ErrorKey.AuthInvalidCredentials,
          HttpStatus.UNAUTHORIZED,
          { extra: 'info' },
        ),
        host,
      );

      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({
        key: 'auth.invalid_credentials',
        statusCode: 401,
        details: { extra: 'info' },
      });
    });

    it('omits details when the exception was raised without any', () => {
      filter.catch(
        new AppException(
          ErrorKey.AuthInvalidCredentials,
          HttpStatus.UNAUTHORIZED,
        ),
        host,
      );

      expect(response.json).toHaveBeenCalledWith({
        key: 'auth.invalid_credentials',
        statusCode: 401,
      });
    });
  });

  describe('Prisma errors', () => {
    function buildPrismaError(
      code: string,
      meta?: Record<string, unknown>,
    ): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError('error', {
        code,
        clientVersion: '7.7.0',
        meta,
      });
    }

    it('maps P2002 with a target list to db.unique_violation with fields', () => {
      filter.catch(buildPrismaError('P2002', { target: ['email'] }), host);

      expect(response.status).toHaveBeenCalledWith(409);
      expect(response.json).toHaveBeenCalledWith({
        key: 'db.unique_violation',
        statusCode: 409,
        details: { fields: ['email'] },
      });
    });

    it('maps P2002 without a target to db.unique_violation without details', () => {
      filter.catch(buildPrismaError('P2002'), host);

      expect(response.json).toHaveBeenCalledWith({
        key: 'db.unique_violation',
        statusCode: 409,
      });
    });

    it('maps P2025 to db.not_found 404', () => {
      filter.catch(buildPrismaError('P2025'), host);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({
        key: 'db.not_found',
        statusCode: 404,
      });
    });

    it('maps any other Prisma code to error.internal 500', () => {
      filter.catch(buildPrismaError('P9999'), host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        key: 'error.internal',
        statusCode: 500,
      });
    });
  });

  describe('Native HttpException mapping', () => {
    it.each([
      [
        'UnauthorizedException',
        new UnauthorizedException(),
        401,
        'auth.unauthorized',
      ],
      ['ForbiddenException', new ForbiddenException(), 403, 'auth.forbidden'],
      ['NotFoundException', new NotFoundException(), 404, 'error.not_found'],
      [
        '429 HttpException',
        new HttpException('too many', HttpStatus.TOO_MANY_REQUESTS),
        429,
        'error.too_many_requests',
      ],
      [
        'BadRequestException',
        new BadRequestException(),
        400,
        'error.bad_request',
      ],
    ])('maps %s to %i %s', (_label, exception, status, key) => {
      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith({ key, statusCode: status });
    });

    it('falls back to error.bad_request for unknown 4xx HttpExceptions', () => {
      filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

      expect(response.status).toHaveBeenCalledWith(418);
      expect(response.json).toHaveBeenCalledWith({
        key: 'error.bad_request',
        statusCode: 418,
      });
    });

    it('falls back to error.internal for 5xx HttpExceptions', () => {
      filter.catch(new HttpException('boom', HttpStatus.BAD_GATEWAY), host);

      expect(response.status).toHaveBeenCalledWith(502);
      expect(response.json).toHaveBeenCalledWith({
        key: 'error.internal',
        statusCode: 502,
      });
    });
  });

  describe('Unknown exceptions', () => {
    it('maps a plain Error to error.internal 500', () => {
      filter.catch(new Error('boom'), host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        key: 'error.internal',
        statusCode: 500,
      });
    });

    it('maps a non-error throw to error.internal 500', () => {
      filter.catch('boom', host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        key: 'error.internal',
        statusCode: 500,
      });
    });
  });

  describe('Logging', () => {
    it('logs exceptions that resolve to a 5xx status', () => {
      filter.catch(new Error('boom'), host);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('does not log exceptions that resolve to a 4xx status', () => {
      filter.catch(new UnauthorizedException(), host);

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
