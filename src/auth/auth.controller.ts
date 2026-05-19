import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import type { PublicUser } from '../users/types/public-user.type';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_COOKIE_NAME } from './constants';
import { buildAccessTokenCookieOptions } from './cookie.helper';
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
    const { accessToken, user } = await this.authService.register(registerDto);
    res.cookie(
      ACCESS_TOKEN_COOKIE_NAME,
      accessToken,
      buildAccessTokenCookieOptions(this.configService),
    );
    return user;
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const { accessToken, user } = await this.authService.login(loginDto);
    res.cookie(
      ACCESS_TOKEN_COOKIE_NAME,
      accessToken,
      buildAccessTokenCookieOptions(this.configService),
    );
    return user;
  }
}
