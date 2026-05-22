import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import ms, { StringValue } from 'ms';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PublicUser } from '../users/types/public-user.type';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokensService } from './refresh-tokens.service';
import { AuthResponse } from './types/auth-response.type';
import { RefreshJwtPayload } from './types/refresh-jwt-payload.type';

const PASSWORD_SALT_ROUNDS = 12;
const DEFAULT_REFRESH_EXPIRES_IN: StringValue = '30d';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly refreshTokensService: RefreshTokensService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const existingUserByEmail = await this.usersService.findByEmail(
      registerDto.email,
    );

    if (existingUserByEmail) {
      throw new AppException(ErrorKey.UserEmailTaken, HttpStatus.BAD_REQUEST);
    }

    const existingUserByUsername = await this.usersService.findByUsername(
      registerDto.username,
    );

    if (existingUserByUsername) {
      throw new AppException(
        ErrorKey.UserUsernameTaken,
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await bcrypt.hash(
      registerDto.password,
      PASSWORD_SALT_ROUNDS,
    );
    const user = await this.usersService.create({
      email: registerDto.email,
      username: registerDto.username,
      passwordHash,
    });

    return this.issueTokenPair(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new AppException(
        ErrorKey.AuthInvalidCredentials,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === UserStatus.DISABLED) {
      throw new AppException(
        ErrorKey.AuthAccountDisabled,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new AppException(
        ErrorKey.AuthInvalidCredentials,
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.issueTokenPair({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  async refreshTokenPair(refreshJwt: string): Promise<AuthResponse> {
    let payload: RefreshJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshJwtPayload>(
        refreshJwt,
        { secret: this.refreshSecret() },
      );
    } catch {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!payload.jti || !payload.sub) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.refreshTokensService.validate(payload.jti);

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status === UserStatus.DISABLED) {
      throw new AppException(
        ErrorKey.AuthAccountDisabled,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const rotated = await this.refreshTokensService.rotate(
      payload.jti,
      user.id,
      this.refreshExpiresInMs(),
    );

    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user.id, rotated.id);

    return { accessToken, refreshToken, user };
  }

  async revokeRefreshToken(refreshJwt: string | undefined): Promise<void> {
    if (!refreshJwt) return;

    try {
      const payload = await this.jwtService.verifyAsync<RefreshJwtPayload>(
        refreshJwt,
        { secret: this.refreshSecret() },
      );
      if (payload.jti) {
        await this.refreshTokensService.revoke(payload.jti);
      }
    } catch {
      this.logger.debug(
        'Invalid refresh token presented at logout; skipping DB revoke',
      );
    }
  }

  private async issueTokenPair(user: PublicUser): Promise<AuthResponse> {
    const { id: jti } = await this.refreshTokensService.issue(
      user.id,
      this.refreshExpiresInMs(),
    );

    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user.id, jti);

    return { accessToken, refreshToken, user };
  }

  private signAccessToken(user: PublicUser): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private signRefreshToken(userId: string, jti: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.refreshSecret(),
        expiresIn:
          this.configService.get<StringValue | number>(
            'jwt.refreshExpiresIn',
          ) ?? DEFAULT_REFRESH_EXPIRES_IN,
        jwtid: jti,
      },
    );
  }

  private refreshSecret(): string {
    return this.configService.getOrThrow<string>('jwt.refreshSecret');
  }

  private refreshExpiresInMs(): number {
    const value = this.configService.get<StringValue | number>(
      'jwt.refreshExpiresIn',
    );
    if (typeof value === 'number') return value * 1000;
    if (typeof value === 'string') {
      const parsed = ms(value);
      if (typeof parsed === 'number') return parsed;
    }
    return 30 * 24 * 60 * 60 * 1000;
  }
}
