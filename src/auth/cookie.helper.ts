import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import ms, { StringValue } from 'ms';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function buildAccessTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: resolveMaxAge(
      configService.get<StringValue | number>('jwt.expiresIn'),
    ),
  };
}

export function buildClearAccessTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const options = buildAccessTokenCookieOptions(configService);
  return { ...options, maxAge: 0 };
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
