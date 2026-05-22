import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { resetTestDatabase } from './test-db';

type AuthSuccessResponse = {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function extractCookie(name: string, setCookieHeader: unknown): string | null {
  const cookies = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const prefix = `${name}=`;
  const cookie = cookies.find((c) => c.startsWith(prefix));
  if (!cookie) return null;
  const value = cookie.split(';')[0]?.split('=')[1];
  return value && value.length > 0 ? value : null;
}

function extractAccessTokenCookie(setCookieHeader: unknown): string | null {
  return extractCookie('access_token', setCookieHeader);
}

function extractRefreshTokenCookie(setCookieHeader: unknown): string | null {
  return extractCookie('refresh_token', setCookieHeader);
}

type ErrorResponse = {
  key: string;
  statusCode: number;
  details?: Record<string, unknown>;
};

type ValidationFieldError = {
  field: string;
  constraints: string[];
};

type ValidationErrorResponse = {
  key: string;
  statusCode: number;
  details: {
    fields: ValidationFieldError[];
  };
};

describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user with valid data and sets the access_token cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'maria@example.com',
        username: 'maria123',
        password: 'password123',
      });
    const body = response.body as AuthSuccessResponse;

    expect(response.status).toBe(201);
    expect(extractAccessTokenCookie(response.headers['set-cookie'])).toEqual(
      expect.any(String),
    );
    expect(body).toMatchObject({
      email: 'maria@example.com',
      username: 'maria123',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('accessToken');
  });

  it('logs in with valid credentials and sets the access_token cookie', async () => {
    await registerUser({
      email: 'login@example.com',
      username: 'loginuser',
      password: 'password123',
    });

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'login@example.com',
        password: 'password123',
      });
    const body = response.body as AuthSuccessResponse;

    expect(response.status).toBe(200);
    expect(extractAccessTokenCookie(response.headers['set-cookie'])).toEqual(
      expect.any(String),
    );
    expect(body).toMatchObject({
      email: 'login@example.com',
      username: 'loginuser',
      role: 'USER',
      status: 'ACTIVE',
    });
  });

  it('rejects login with invalid credentials', async () => {
    await registerUser({
      email: 'invalid-login@example.com',
      username: 'invalidlogin',
      password: 'password123',
    });

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'invalid-login@example.com',
        password: 'wrongpassword',
      });
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.key).toBe('auth.invalid_credentials');
  });

  it('rejects duplicate email registration', async () => {
    await registerUser({
      email: 'duplicate-email@example.com',
      username: 'firstuser',
      password: 'password123',
    });

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'duplicate-email@example.com',
        username: 'seconduser',
        password: 'password123',
      });
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.key).toBe('user.email_taken');
  });

  it('rejects duplicate username registration', async () => {
    await registerUser({
      email: 'first-username@example.com',
      username: 'duplicateuser',
      password: 'password123',
    });

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'second-username@example.com',
        username: 'duplicateuser',
        password: 'password123',
      });
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(400);
    expect(body.key).toBe('user.username_taken');
  });

  it('rejects registration with an invalid email format', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'not-an-email',
        username: 'maria',
        password: 'password123',
      });
    const body = response.body as ValidationErrorResponse;
    const emailField = body.details.fields.find((f) => f.field === 'email');

    expect(response.status).toBe(400);
    expect(body.key).toBe('validation.failed');
    expect(emailField?.constraints).toContain('isEmail');
  });

  it('rejects registration when an unknown field is sent', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'maria@example.com',
        username: 'maria',
        password: 'password123',
        role: 'admin',
      });
    const body = response.body as ValidationErrorResponse;
    const roleField = body.details.fields.find((f) => f.field === 'role');

    expect(response.status).toBe(400);
    expect(body.key).toBe('validation.failed');
    expect(roleField?.constraints).toContain('whitelistValidation');
  });

  it('allows access to a protected route with the cookie set by register', async () => {
    const registerResponse = await registerUser({
      email: 'protected@example.com',
      username: 'protecteduser',
      password: 'password123',
    });

    const setCookieRaw = registerResponse.headers['set-cookie'] as unknown as
      | string
      | string[];
    const cookies = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw];
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: 'protected@example.com',
      username: 'protecteduser',
      role: 'USER',
      status: 'ACTIVE',
    });
  });

  it('trims whitespace around the email and username on registration', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: '  trimmed@example.com  ',
        username: '  trimmeduser  ',
        password: 'password123',
      });
    const body = response.body as AuthSuccessResponse;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      email: 'trimmed@example.com',
      username: 'trimmeduser',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: '  trimmed@example.com  ',
        password: 'password123',
      });

    expect(loginResponse.status).toBe(200);
  });

  it('rejects access to a protected route without a token', async () => {
    const response = await request(app.getHttpServer()).get('/users/me');
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.key).toBe('auth.unauthorized');
  });

  it('rejects access to a protected route with an invalid token', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer invalid-token');
    const body = response.body as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.key).toBe('auth.unauthorized');
  });

  describe('POST /auth/logout', () => {
    it('returns 204 and instructs the browser to clear the access_token cookie', async () => {
      const response = await request(app.getHttpServer()).post('/auth/logout');

      expect(response.status).toBe(204);

      const setCookieRaw = response.headers['set-cookie'] as unknown as
        | string
        | string[];
      const cookies = Array.isArray(setCookieRaw)
        ? setCookieRaw
        : [setCookieRaw];
      const clearCookie = cookies.find((c) => c.startsWith('access_token='));

      expect(clearCookie).toBeDefined();
      expect(clearCookie).toMatch(/^access_token=;/);
      expect(clearCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });

    it('works even without an authenticated request (idempotent)', async () => {
      const response = await request(app.getHttpServer()).post('/auth/logout');

      expect(response.status).toBe(204);
    });

    it('revokes the refresh token so it can no longer be used to refresh', async () => {
      const registerResponse = await registerUser({
        email: 'logout-revoke@example.com',
        username: 'logoutrevoke',
        password: 'password123',
      });
      const refreshToken = extractRefreshTokenCookie(
        registerResponse.headers['set-cookie'],
      ) as string;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `refresh_token=${refreshToken}`);

      const refreshResponse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`);
      const body = refreshResponse.body as ErrorResponse;

      expect(refreshResponse.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 401 when no refresh cookie is sent', async () => {
      const response = await request(app.getHttpServer()).post('/auth/refresh');
      const body = response.body as ErrorResponse;

      expect(response.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('returns 401 when the refresh cookie is a malformed JWT', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refresh_token=not-a-jwt');
      const body = response.body as ErrorResponse;

      expect(response.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('returns 200, a new pair of cookies, and the user when the refresh cookie is valid', async () => {
      const registerResponse = await registerUser({
        email: 'refresh-ok@example.com',
        username: 'refreshok',
        password: 'password123',
      });
      const originalRefresh = extractRefreshTokenCookie(
        registerResponse.headers['set-cookie'],
      ) as string;

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${originalRefresh}`);
      const body = response.body as AuthSuccessResponse;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        email: 'refresh-ok@example.com',
        username: 'refreshok',
      });

      const rotatedAccess = extractAccessTokenCookie(
        response.headers['set-cookie'],
      );
      const rotatedRefresh = extractRefreshTokenCookie(
        response.headers['set-cookie'],
      );

      expect(rotatedAccess).toEqual(expect.any(String));
      expect(rotatedRefresh).toEqual(expect.any(String));
      expect(rotatedRefresh).not.toBe(originalRefresh);
    });

    it('rejects the old refresh token after it has been rotated', async () => {
      const registerResponse = await registerUser({
        email: 'rotation@example.com',
        username: 'rotationuser',
        password: 'password123',
      });
      const originalRefresh = extractRefreshTokenCookie(
        registerResponse.headers['set-cookie'],
      ) as string;

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${originalRefresh}`)
        .expect(200);

      const replay = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${originalRefresh}`);
      const body = replay.body as ErrorResponse;

      expect(replay.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('revokes ALL sessions for the user when an already-rotated token is replayed', async () => {
      // Session 1
      const session1 = await registerUser({
        email: 'multi-session@example.com',
        username: 'multisession',
        password: 'password123',
      });
      const session1Refresh = extractRefreshTokenCookie(
        session1.headers['set-cookie'],
      ) as string;

      // Session 2 (same user, second login = second device)
      const session2 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'multi-session@example.com',
          password: 'password123',
        });
      const session2Refresh = extractRefreshTokenCookie(
        session2.headers['set-cookie'],
      ) as string;

      // Session 1 rotates legitimately
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${session1Refresh}`)
        .expect(200);

      // Attacker replays the (now-rotated) session 1 refresh → reuse detected
      const reuseAttempt = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${session1Refresh}`);
      expect(reuseAttempt.status).toBe(401);

      // Session 2 is also dead now (all-session revoke triggered)
      const session2Attempt = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${session2Refresh}`);
      const body = session2Attempt.body as ErrorResponse;

      expect(session2Attempt.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });
  });

  function registerUser(data: {
    email: string;
    username: string;
    password: string;
  }) {
    return request(app.getHttpServer()).post('/auth/register').send(data);
  }
});
