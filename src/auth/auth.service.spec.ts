import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshToken, User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PublicUser } from '../users/types/public-user.type';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshTokensService } from './refresh-tokens.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findByUsername' | 'findById' | 'create'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync' | 'verifyAsync'>>;
  let refreshTokensService: jest.Mocked<
    Pick<RefreshTokensService, 'issue' | 'validate' | 'rotate' | 'revoke'>
  >;

  const fullUser: User = {
    id: 'user-id',
    email: 'maria@example.com',
    username: 'maria',
    passwordHash: 'stored-hash',
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
  };

  const publicUser: PublicUser = {
    id: fullUser.id,
    email: fullUser.email,
    username: fullUser.username,
    role: fullUser.role,
    status: fullUser.status,
    createdAt: fullUser.createdAt,
    updatedAt: fullUser.updatedAt,
  };

  const validRefreshDbRow: RefreshToken = {
    id: 'jti-1',
    userId: fullUser.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    replacedById: null,
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    refreshTokensService = {
      issue: jest.fn().mockResolvedValue({
        id: 'jti-1',
        expiresAt: validRefreshDbRow.expiresAt,
      }),
      validate: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };

    // jwtService.signAsync returns different values depending on whether refresh secret is in options
    jwtService.signAsync.mockImplementation(((
      _payload: unknown,
      options?: { secret?: string },
    ) =>
      Promise.resolve(
        options?.secret ? 'refresh-jwt' : 'access-jwt',
      )) as never);

    const configService = {
      get: jest.fn().mockReturnValue('30d'),
      getOrThrow: jest.fn().mockReturnValue('refresh-secret'),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RefreshTokensService, useValue: refreshTokensService },
      ],
    }).compile();

    service = module.get(AuthService);

    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const dto = {
      email: 'maria@example.com',
      username: 'maria',
      password: 'password123',
    };

    it('creates the user and issues access + refresh tokens', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue(null);
      usersService.create.mockResolvedValue(publicUser);

      const result = await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(refreshTokensService.issue).toHaveBeenCalledWith(
        publicUser.id,
        expect.any(Number),
      );
      expect(result).toEqual({
        accessToken: 'access-jwt',
        refreshToken: 'refresh-jwt',
        user: publicUser,
      });
    });

    it('throws user.email_taken when the email is already used', async () => {
      usersService.findByEmail.mockResolvedValue(fullUser);

      await expect(service.register(dto)).rejects.toMatchObject({
        key: ErrorKey.UserEmailTaken,
      });
      expect(refreshTokensService.issue).not.toHaveBeenCalled();
    });

    it('throws user.username_taken when the username is already used', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue(publicUser);

      await expect(service.register(dto)).rejects.toMatchObject({
        key: ErrorKey.UserUsernameTaken,
      });
      expect(refreshTokensService.issue).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto = { email: 'maria@example.com', password: 'password123' };

    it('returns access + refresh tokens when credentials are valid', async () => {
      usersService.findByEmail.mockResolvedValue(fullUser);

      const result = await service.login(dto);

      expect(refreshTokensService.issue).toHaveBeenCalledWith(
        fullUser.id,
        expect.any(Number),
      );
      expect(result).toEqual({
        accessToken: 'access-jwt',
        refreshToken: 'refresh-jwt',
        user: publicUser,
      });
    });

    it('throws auth.invalid_credentials when no user matches the email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toMatchObject({
        key: ErrorKey.AuthInvalidCredentials,
      });
    });

    it('throws auth.invalid_credentials when the password does not match', async () => {
      usersService.findByEmail.mockResolvedValue(fullUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toMatchObject({
        key: ErrorKey.AuthInvalidCredentials,
      });
    });

    it('throws auth.account_disabled when the user is disabled', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...fullUser,
        status: UserStatus.DISABLED,
      });

      await expect(service.login(dto)).rejects.toMatchObject({
        key: ErrorKey.AuthAccountDisabled,
      });
    });
  });

  describe('refreshTokenPair', () => {
    it('validates the JWT, rotates the DB row, and issues a new pair', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: fullUser.id,
        jti: 'jti-1',
      } as never);
      refreshTokensService.validate.mockResolvedValue(validRefreshDbRow);
      usersService.findById.mockResolvedValue(publicUser);
      refreshTokensService.rotate.mockResolvedValue({
        id: 'jti-2',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });

      const result = await service.refreshTokenPair('refresh-token');

      expect(refreshTokensService.validate).toHaveBeenCalledWith('jti-1');
      expect(refreshTokensService.rotate).toHaveBeenCalledWith(
        'jti-1',
        fullUser.id,
        expect.any(Number),
      );
      expect(result.accessToken).toBe('access-jwt');
      expect(result.refreshToken).toBe('refresh-jwt');
      expect(result.user).toEqual(publicUser);
    });

    it('throws auth.unauthorized when the JWT signature is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));

      await expect(service.refreshTokenPair('bad')).rejects.toMatchObject({
        key: ErrorKey.AuthUnauthorized,
      });
      expect(refreshTokensService.validate).not.toHaveBeenCalled();
    });

    it('throws auth.unauthorized when the user no longer exists', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-id',
        jti: 'jti-1',
      } as never);
      refreshTokensService.validate.mockResolvedValue(validRefreshDbRow);
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.refreshTokenPair('refresh-token'),
      ).rejects.toMatchObject({ key: ErrorKey.AuthUnauthorized });
    });

    it('throws auth.account_disabled when the user has been disabled', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-id',
        jti: 'jti-1',
      } as never);
      refreshTokensService.validate.mockResolvedValue(validRefreshDbRow);
      usersService.findById.mockResolvedValue({
        ...publicUser,
        status: UserStatus.DISABLED,
      });

      await expect(
        service.refreshTokenPair('refresh-token'),
      ).rejects.toMatchObject({ key: ErrorKey.AuthAccountDisabled });
    });
  });

  describe('revokeRefreshToken', () => {
    it('is a no-op when no token is provided', async () => {
      await service.revokeRefreshToken(undefined);
      expect(refreshTokensService.revoke).not.toHaveBeenCalled();
    });

    it('revokes the row when the token can be decoded', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-id',
        jti: 'jti-1',
      } as never);

      await service.revokeRefreshToken('refresh-token');

      expect(refreshTokensService.revoke).toHaveBeenCalledWith('jti-1');
    });

    it('silently ignores an invalid token (best-effort)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await service.revokeRefreshToken('refresh-token');

      expect(refreshTokensService.revoke).not.toHaveBeenCalled();
    });
  });
});
