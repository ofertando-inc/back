import { HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';

import { AppException } from '../exceptions/app.exception';
import { validationExceptionFactory } from './validation-exception.factory';

function buildValidationError(
  partial: Partial<ValidationError>,
): ValidationError {
  return { children: [], ...partial } as ValidationError;
}

describe('validationExceptionFactory', () => {
  it('returns an AppException with the validation.failed key and a 400 status', () => {
    const result = validationExceptionFactory([
      buildValidationError({
        property: 'email',
        constraints: { isEmail: 'must be email' },
      }),
    ]);

    expect(result).toBeInstanceOf(AppException);
    expect(result.key).toBe('validation.failed');
    expect(result.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('flattens a top-level error into one field with constraint names', () => {
    const result = validationExceptionFactory([
      buildValidationError({
        property: 'email',
        constraints: { isEmail: 'must be email' },
      }),
    ]);

    expect(result.details).toEqual({
      fields: [{ field: 'email', constraints: ['isEmail'] }],
    });
  });

  it('returns every constraint name when several rules failed on the same field', () => {
    const result = validationExceptionFactory([
      buildValidationError({
        property: 'password',
        constraints: {
          minLength: 'too short',
          isString: 'must be string',
        },
      }),
    ]);

    expect(result.details).toEqual({
      fields: [{ field: 'password', constraints: ['minLength', 'isString'] }],
    });
  });

  it('flattens nested errors using a dotted field path', () => {
    const result = validationExceptionFactory([
      buildValidationError({
        property: 'address',
        children: [
          buildValidationError({
            property: 'city',
            constraints: { isString: 'must be string' },
          }),
        ],
      }),
    ]);

    expect(result.details).toEqual({
      fields: [{ field: 'address.city', constraints: ['isString'] }],
    });
  });

  it('returns an empty fields list when no errors are provided', () => {
    const result = validationExceptionFactory([]);

    expect(result.details).toEqual({ fields: [] });
  });

  it('skips errors that carry neither constraints nor children', () => {
    const result = validationExceptionFactory([
      buildValidationError({ property: 'orphan' }),
    ]);

    expect(result.details).toEqual({ fields: [] });
  });
});
