import { HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';

interface ValidationFieldError {
  field: string;
  constraints: string[];
}

export function validationExceptionFactory(
  errors: ValidationError[],
): AppException {
  const fields = flattenValidationErrors(errors);
  return new AppException(ErrorKey.ValidationFailed, HttpStatus.BAD_REQUEST, {
    fields,
  });
}

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationFieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const items: ValidationFieldError[] = [];

    if (error.constraints) {
      items.push({ field, constraints: Object.keys(error.constraints) });
    }

    if (error.children?.length) {
      items.push(...flattenValidationErrors(error.children, field));
    }

    return items;
  });
}
