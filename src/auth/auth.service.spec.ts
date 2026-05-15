import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PublicUser } from '../users/types/public-user.type';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findByUsername' | 'create'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;

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

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      create: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
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

    it('creates the user and returns an auth response on success', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue(null);
      usersService.create.mockResolvedValue(publicUser);

      const result = await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(usersService.create).toHaveBeenCalledWith({
        email: dto.email,
        username: dto.username,
        passwordHash: 'hashed-password',
      });
      expect(result).toEqual({
        accessToken: 'jwt-token',
        user: publicUser,
      });
    });

    it('throws user.email_taken when the email is already used', async () => {
      usersService.findByEmail.mockResolvedValue(fullUser);

      await expect(service.register(dto)).rejects.toMatchObject({
        key: ErrorKey.UserEmailTaken,
      });
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('throws user.username_taken when the username is already used', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.findByUsername.mockResolvedValue(publicUser);

      await expect(service.register(dto)).rejects.toMatchObject({
        key: ErrorKey.UserUsernameTaken,
      });
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto = { email: 'maria@example.com', password: 'password123' };

    it('returns an auth response when credentials are valid', async () => {
      usersService.findByEmail.mockResolvedValue(fullUser);

      const result = await service.login(dto);

      expect(bcrypt.compare).toHaveBeenCalledWith(
        dto.password,
        fullUser.passwordHash,
      );
      expect(result).toEqual({
        accessToken: 'jwt-token',
        user: publicUser,
      });
    });

    it('throws auth.invalid_credentials when no user matches the email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toMatchObject({
        key: ErrorKey.AuthInvalidCredentials,
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
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
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });
});
