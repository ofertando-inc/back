import { ExecutionContext } from '@nestjs/common';
import { AccountType, UserRole, UserStatus } from '@prisma/client';

import type { BusinessRequest } from '../../modules/identity/business/types/business-request.type';
import type { PublicUser } from '../../modules/identity/users/types/public-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { BusinessGuard } from './business.guard';

function buildContext(user: PublicUser | null): {
  ctx: ExecutionContext;
  req: BusinessRequest;
} {
  const req = { user } as unknown as BusinessRequest;
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const businessUser: PublicUser = {
  id: 'biz-1',
  email: 'biz@b.com',
  username: 'biz',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  reputation: 0,
  accountType: AccountType.BUSINESS,
  createdAt: new Date('2020-01-01T00:00:00Z'),
  updatedAt: new Date('2020-01-01T00:00:00Z'),
};

describe('BusinessGuard', () => {
  let guard: BusinessGuard;
  let merchant: { findFirst: jest.Mock };

  beforeEach(() => {
    merchant = { findFirst: jest.fn() };
    guard = new BusinessGuard({ merchant } as unknown as PrismaService);
  });

  it('passes and attaches the owned merchant for an affiliated business', async () => {
    const owned = {
      id: 'm1',
      name: 'Acme',
      verified: true,
      blockedAt: null,
    };
    merchant.findFirst.mockResolvedValue(owned);
    const { ctx, req } = buildContext(businessUser);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(merchant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'biz-1' } }),
    );
    expect(req.merchant).toEqual(owned);
  });

  it('throws account.not_business for an individual account', async () => {
    const { ctx } = buildContext({
      ...businessUser,
      accountType: AccountType.INDIVIDUAL,
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.AccountNotBusiness,
    });
    expect(merchant.findFirst).not.toHaveBeenCalled();
  });

  it('throws account.no_affiliation for a business without an approved claim', async () => {
    merchant.findFirst.mockResolvedValue(null);
    const { ctx } = buildContext(businessUser);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.AccountNoAffiliation,
    });
  });

  it('throws auth.unauthorized when no user is attached to the request', async () => {
    const { ctx } = buildContext(null);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(AppException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      key: ErrorKey.AuthUnauthorized,
    });
  });
});
