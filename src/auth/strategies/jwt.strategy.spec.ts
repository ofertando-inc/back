import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';

import { ErrorKey } from '../../common/exceptions/error-keys';
import { PublicUser } from '../../users/types/public-user.type';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../types/jwt-payload.type';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;

  const publicUser: PublicUser = {
    id: 'user-id',
    email: 'maria@example.com',
    username: 'maria',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
  };

  const payload: JwtPayload = {
    sub: publicUser.id,
    email: publicUser.email,
    role: publicUser.role,
  };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('returns the user when found and active', async () => {
    usersService.findById.mockResolvedValue(publicUser);

    const result = await strategy.validate(payload);

    expect(result).toEqual(publicUser);
  });

  it('throws auth.unauthorized when the user is not found', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      key: ErrorKey.AuthUnauthorized,
    });
  });

  it('throws auth.account_disabled when the user is disabled', async () => {
    usersService.findById.mockResolvedValue({
      ...publicUser,
      status: UserStatus.DISABLED,
    });

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      key: ErrorKey.AuthAccountDisabled,
    });
  });
});
