import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { resetTestDatabase } from './test-db';

type AuthSuccessResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
};

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

  it('registers a user with valid data', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'maria@example.com',
        username: 'maria123',
        password: 'password123',
      });
    const body = response.body as AuthSuccessResponse;

    expect(response.status).toBe(201);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({
      email: 'maria@example.com',
      username: 'maria123',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('logs in with valid credentials', async () => {
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
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({
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

  it('allows access to a protected route with a valid JWT', async () => {
    const registerResponse = await registerUser({
      email: 'protected@example.com',
      username: 'protecteduser',
      password: 'password123',
    });
    const registerBody = registerResponse.body as AuthSuccessResponse;

    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${registerBody.accessToken}`);

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
    expect(body.user).toMatchObject({
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

  function registerUser(data: {
    email: string;
    username: string;
    password: string;
  }) {
    return request(app.getHttpServer()).post('/auth/register').send(data);
  }
});
