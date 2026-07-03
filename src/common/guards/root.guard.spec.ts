import { ExecutionContext } from '@nestjs/common';
import { AccountType, UserRole, UserStatus } from '@prisma/client';

import type { AuthenticatedRequest } from '../../modules/identity/auth/types/authenticated-request.type';
import type { PublicUser } from '../../modules/identity/users/types/public-user.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { RootGuard } from './root.guard';

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
  reputation: 0,
  accountType: AccountType.INDIVIDUAL,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-01T00:00:00Z'),
};

describe('RootGuard', () => {
  let guard: RootGuard;

  beforeEach(() => {
    guard = new RootGuard();
  });

  it('returns true when the user has the ROOT role', () => {
    const ctx = buildContext({ ...baseUser, role: UserRole.ROOT });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws auth.forbidden_root for an ADMIN (root-only route)', () => {
    const ctx = buildContext({ ...baseUser, role: UserRole.ADMIN });

    try {
      guard.canActivate(ctx);
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).key).toBe(ErrorKey.AuthForbiddenRoot);
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
