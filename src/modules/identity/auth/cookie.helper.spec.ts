import { ConfigService } from '@nestjs/config';

import {
  buildAccessTokenCookieOptions,
  buildClearAccessTokenCookieOptions,
  buildClearRefreshTokenCookieOptions,
  buildRefreshTokenCookieOptions,
} from './cookie.helper';

function configWith(expiresIn: string | number | undefined): ConfigService {
  return {
    get: jest.fn().mockReturnValue(expiresIn),
  } as unknown as ConfigService;
}

describe('cookie.helper', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('buildAccessTokenCookieOptions', () => {
    it('defaults to 1 day when expiresIn is missing', () => {
      const options = buildAccessTokenCookieOptions(configWith(undefined));
      expect(options.maxAge).toBe(24 * 60 * 60 * 1000);
    });

    it('parses string durations via ms', () => {
      const options = buildAccessTokenCookieOptions(configWith('15m'));
      expect(options.maxAge).toBe(15 * 60 * 1000);
    });

    it('treats numeric expiresIn as seconds (jwt convention)', () => {
      const options = buildAccessTokenCookieOptions(configWith(3600));
      expect(options.maxAge).toBe(3600 * 1000);
    });

    it('falls back to 1 day when ms cannot parse the string', () => {
      const options = buildAccessTokenCookieOptions(
        configWith('not-a-duration'),
      );
      expect(options.maxAge).toBe(24 * 60 * 60 * 1000);
    });

    it('sets HttpOnly, SameSite=Lax, path=/', () => {
      const options = buildAccessTokenCookieOptions(configWith('1d'));
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.path).toBe('/');
    });

    it('reads Secure from COOKIE_SECURE env (true)', () => {
      process.env.COOKIE_SECURE = 'true';
      const options = buildAccessTokenCookieOptions(configWith('1d'));
      expect(options.secure).toBe(true);
    });

    it('reads Secure from COOKIE_SECURE env (false by default)', () => {
      delete process.env.COOKIE_SECURE;
      const options = buildAccessTokenCookieOptions(configWith('1d'));
      expect(options.secure).toBe(false);
    });

    it('reads Domain from COOKIE_DOMAIN env when set', () => {
      process.env.COOKIE_DOMAIN = '.ofertando.co';
      const options = buildAccessTokenCookieOptions(configWith('1d'));
      expect(options.domain).toBe('.ofertando.co');
    });

    it('leaves domain undefined when COOKIE_DOMAIN is unset', () => {
      delete process.env.COOKIE_DOMAIN;
      const options = buildAccessTokenCookieOptions(configWith('1d'));
      expect(options.domain).toBeUndefined();
    });
  });

  describe('buildClearAccessTokenCookieOptions', () => {
    it('mirrors the access token options but forces maxAge to 0', () => {
      process.env.COOKIE_DOMAIN = '.ofertando.co';
      const options = buildClearAccessTokenCookieOptions(configWith('1d'));
      expect(options.maxAge).toBe(0);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.domain).toBe('.ofertando.co');
    });
  });

  describe('buildRefreshTokenCookieOptions', () => {
    it('uses path=/auth/refresh and the refresh expiry from config', () => {
      const options = buildRefreshTokenCookieOptions(configWith('30d'));
      expect(options.path).toBe('/auth');
      expect(options.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
    });

    it('shares the base security attributes with the access cookie', () => {
      process.env.COOKIE_SECURE = 'true';
      process.env.COOKIE_DOMAIN = '.ofertando.co';
      const options = buildRefreshTokenCookieOptions(configWith('30d'));
      expect(options.secure).toBe(true);
      expect(options.domain).toBe('.ofertando.co');
    });

    it('defaults to 1 day when the refresh expiry is unset', () => {
      const options = buildRefreshTokenCookieOptions(configWith(undefined));
      expect(options.maxAge).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('buildClearRefreshTokenCookieOptions', () => {
    it('mirrors the refresh token options but forces maxAge to 0', () => {
      const options = buildClearRefreshTokenCookieOptions(configWith('30d'));
      expect(options.maxAge).toBe(0);
      expect(options.path).toBe('/auth');
    });
  });
});
