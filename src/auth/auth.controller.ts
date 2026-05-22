import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import type { PublicUser } from '../users/types/public-user.type';
import { AuthService } from './auth.service';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from './constants';
import {
  buildAccessTokenCookieOptions,
  buildClearAccessTokenCookieOptions,
  buildClearRefreshTokenCookieOptions,
  buildRefreshTokenCookieOptions,
} from './cookie.helper';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const { accessToken, refreshToken, user } =
      await this.authService.register(registerDto);
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const { accessToken, refreshToken, user } =
      await this.authService.login(loginDto);
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const refreshJwt = this.readRefreshCookie(req);
    if (refreshJwt === null) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { accessToken, refreshToken, user } =
      await this.authService.refreshTokenPair(refreshJwt);
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshJwt = this.readRefreshCookie(req);
    if (refreshJwt !== null) {
      await this.authService.revokeRefreshToken(refreshJwt);
    }
    res.clearCookie(
      ACCESS_TOKEN_COOKIE_NAME,
      buildClearAccessTokenCookieOptions(this.configService),
    );
    res.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      buildClearRefreshTokenCookieOptions(this.configService),
    );
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE_NAME,
      accessToken,
      buildAccessTokenCookieOptions(this.configService),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      refreshToken,
      buildRefreshTokenCookieOptions(this.configService),
    );
  }

  private readRefreshCookie(req: Request): string | null {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
