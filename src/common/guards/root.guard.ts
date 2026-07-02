import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthenticatedRequest } from '../../modules/identity/auth/types/authenticated-request.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';

// Super-admin gate: account management and claim decisions are ROOT-only.
@Injectable()
export class RootGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.role !== UserRole.ROOT) {
      throw new AppException(ErrorKey.AuthForbiddenRoot, HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
