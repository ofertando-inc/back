import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  user: { id: string; username: string };
};

type StatsBody = { offerCount: number; commentCount: number };

function extractAccessTokenCookie(setCookieHeader: unknown): string {
  const cookies = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const cookie = cookies.find((c) => c.startsWith('access_token='));
  return cookie?.split(';')[0]?.split('=')[1] ?? '';
}

function futureIso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000).toISOString();
}

describe('Users flow (e2e)', () => {
  let app: INestApplication<App>;
  let categoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const cats = await request(app.getHttpServer()).get('/categories');
    categoryId = (cats.body as { id: string }[])[0].id;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(
    email: string,
    username: string,
  ): Promise<RegisteredUser> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, username, password: 'password123' });
    return {
      accessToken: extractAccessTokenCookie(response.headers['set-cookie']),
      user: response.body as RegisteredUser['user'],
    };
  }

  async function createOffer(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'An offer',
        description: 'A very compelling description',
        offerType: 'discount',
        storeName: 'Acme',
        city: 'Bogotá',
        startDate: futureIso(1),
        endDate: futureIso(7),
        categoryIds: [categoryId],
      });
    return (response.body as { id: string }).id;
  }

  describe('GET /users/me/stats', () => {
    it('rejects without authentication with 401', async () => {
      const res = await request(app.getHttpServer()).get('/users/me/stats');
      expect(res.status).toBe(401);
    });

    it('counts the authenticated user offers and comments', async () => {
      const user = await registerUser('user@example.com', 'user');
      const offerA = await createOffer(user.accessToken);
      await createOffer(user.accessToken);
      await request(app.getHttpServer())
        .post(`/offers/${offerA}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ content: 'my comment' });

      const res = await request(app.getHttpServer())
        .get('/users/me/stats')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body as StatsBody).toEqual({ offerCount: 2, commentCount: 1 });
    });
  });
});
