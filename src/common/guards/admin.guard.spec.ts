import { ExecutionContext } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import type { PublicUser } from '../../users/types/public-user.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { AdminGuard } from './admin.guard';

function buildContext(user: PublicUser | null): ExecutionContext {
  const req = { user } as unknown as AuthenticatedRequest;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

const baseUser: PublicUser = {
  id: 'user-1',
  email: 'a@b.com',
  username: 'user',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-01T00:00:00Z'),
};

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('returns true when the user has the ADMIN role', () => {
    const ctx = buildContext({ ...baseUser, role: UserRole.ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws auth.forbidden when the user has the USER role', () => {
    const ctx = buildContext(baseUser);

    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).key).toBe(ErrorKey.AuthForbidden);
    }
  });

  it('throws auth.unauthorized when no user is attached to the request', () => {
    const ctx = buildContext(null);

    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).key).toBe(ErrorKey.AuthUnauthorized);
    }
  });
});
