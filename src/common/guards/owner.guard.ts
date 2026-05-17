import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';

@Injectable()
export abstract class OwnerGuard implements CanActivate {
  protected abstract readonly notFoundKey: ErrorKey;
  protected abstract readonly forbiddenKey: ErrorKey;

  protected abstract resolveOwnerId(
    req: AuthenticatedRequest,
  ): Promise<string | null>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.role === UserRole.ADMIN) {
      return true;
    }

    const ownerId = await this.resolveOwnerId(req);

    if (ownerId === null) {
      throw new AppException(this.notFoundKey, HttpStatus.NOT_FOUND);
    }

    if (ownerId !== user.id) {
      throw new AppException(this.forbiddenKey, HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
