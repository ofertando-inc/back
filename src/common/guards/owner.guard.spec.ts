import { ExecutionContext } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import type { PublicUser } from '../../users/types/public-user.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { OwnerGuard } from './owner.guard';

class FixedOwnerGuard extends OwnerGuard {
  protected readonly notFoundKey = ErrorKey.OfferNotFound;
  protected readonly forbiddenKey = ErrorKey.OfferForbidden;

  constructor(private readonly ownerId: string | null) {
    super();
  }

  protected resolveOwnerId(): Promise<string | null> {
    return Promise.resolve(this.ownerId);
  }
}

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

describe('OwnerGuard', () => {
  it('returns true when the user is an admin, regardless of resource owner', async () => {
    const guard = new FixedOwnerGuard('someone-else');
    const ctx = buildContext({ ...baseUser, role: UserRole.ADMIN });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('returns true when the user owns the resource', async () => {
    const guard = new FixedOwnerGuard(baseUser.id);
    const ctx = buildContext(baseUser);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws the configured not-found key when the resource does not exist', async () => {
    const guard = new FixedOwnerGuard(null);
    const ctx = buildContext(baseUser);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(AppException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.OfferNotFound,
    });
  });

  it('throws the configured forbidden key when the user is not the owner', async () => {
    const guard = new FixedOwnerGuard('another-user');
    const ctx = buildContext(baseUser);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.OfferForbidden,
    });
  });

  it('throws auth.unauthorized when no user is attached to the request', async () => {
    const guard = new FixedOwnerGuard(baseUser.id);
    const ctx = buildContext(null);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.AuthUnauthorized,
    });
  });

  it('does not invoke resolveOwnerId when the user is admin (short-circuit)', async () => {
    const resolveSpy = jest.fn().mockResolvedValue(null);

    class SpyOwnerGuard extends OwnerGuard {
      protected readonly notFoundKey = ErrorKey.OfferNotFound;
      protected readonly forbiddenKey = ErrorKey.OfferForbidden;
      protected resolveOwnerId = resolveSpy;
    }

    const guard = new SpyOwnerGuard();
    const ctx = buildContext({ ...baseUser, role: UserRole.ADMIN });

    await guard.canActivate(ctx);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
