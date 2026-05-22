import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import ms, { StringValue } from 'ms';

import { REFRESH_TOKEN_PATH } from './constants';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function buildBaseCookieOptions(): Pick<
  CookieOptions,
  'httpOnly' | 'sameSite' | 'secure' | 'domain'
> {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export function buildAccessTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  return {
    ...buildBaseCookieOptions(),
    path: '/',
    maxAge: resolveMaxAge(
      configService.get<StringValue | number>('jwt.expiresIn'),
    ),
  };
}

export function buildClearAccessTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  return { ...buildAccessTokenCookieOptions(configService), maxAge: 0 };
}

export function buildRefreshTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  return {
    ...buildBaseCookieOptions(),
    path: REFRESH_TOKEN_PATH,
    maxAge: resolveMaxAge(
      configService.get<StringValue | number>('jwt.refreshExpiresIn'),
    ),
  };
}

export function buildClearRefreshTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  return { ...buildRefreshTokenCookieOptions(configService), maxAge: 0 };
}

function resolveMaxAge(expiresIn: StringValue | number | undefined): number {
  if (typeof expiresIn === 'number') {
    return expiresIn * 1000;
  }
  if (typeof expiresIn === 'string') {
    const parsed = ms(expiresIn);
    return typeof parsed === 'number' ? parsed : ONE_DAY_MS;
  }
  return ONE_DAY_MS;
}
