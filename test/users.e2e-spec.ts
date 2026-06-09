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

type MyCommentBody = {
  id: string;
  content: string;
  score: number;
  replyCount: number;
  hidden: boolean;
  offer: { id: string; title: string };
};

type MyVoteBody = {
  type: 'UP' | 'DOWN';
  offer: { id: string; title: string; score: number };
};

type Paginated<T> = { items: T[]; nextCursor: string | null };

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

  function postComment(token: string, offerId: string, content: string) {
    return request(app.getHttpServer())
      .post(`/offers/${offerId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content });
  }

  function castVote(token: string, offerId: string, type: 'UP' | 'DOWN') {
    return request(app.getHttpServer())
      .post(`/offers/${offerId}/votes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type });
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

  describe('GET /users/me/comments', () => {
    it('rejects without authentication with 401', async () => {
      const res = await request(app.getHttpServer()).get('/users/me/comments');
      expect(res.status).toBe(401);
    });

    it('returns the user comments with their offer context, most recent first', async () => {
      const user = await registerUser('cu@example.com', 'cu');
      const offer = await createOffer(user.accessToken);
      await postComment(user.accessToken, offer, 'first');
      await postComment(user.accessToken, offer, 'second');

      const res = await request(app.getHttpServer())
        .get('/users/me/comments')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      const body = res.body as Paginated<MyCommentBody>;
      expect(body.items).toHaveLength(2);
      expect(body.items[0].content).toBe('second');
      expect(body.items[1].content).toBe('first');
      expect(body.items[0].offer).toEqual({ id: offer, title: 'An offer' });
      expect(body.nextCursor).toBeNull();
    });

    it('paginates with the returned cursor', async () => {
      const user = await registerUser('cp@example.com', 'cp');
      const offer = await createOffer(user.accessToken);
      await postComment(user.accessToken, offer, 'one');
      await postComment(user.accessToken, offer, 'two');

      const first = await request(app.getHttpServer())
        .get('/users/me/comments?limit=1')
        .set('Authorization', `Bearer ${user.accessToken}`);
      const firstBody = first.body as Paginated<MyCommentBody>;
      expect(firstBody.items).toHaveLength(1);
      expect(firstBody.items[0].content).toBe('two');
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer())
        .get(`/users/me/comments?limit=1&cursor=${firstBody.nextCursor}`)
        .set('Authorization', `Bearer ${user.accessToken}`);
      const secondBody = second.body as Paginated<MyCommentBody>;
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.items[0].content).toBe('one');
      expect(secondBody.nextCursor).toBeNull();
    });
  });

  describe('GET /users/me/votes', () => {
    it('rejects without authentication with 401', async () => {
      const res = await request(app.getHttpServer()).get('/users/me/votes');
      expect(res.status).toBe(401);
    });

    it('returns the offers the user voted on with the vote type', async () => {
      const user = await registerUser('vu@example.com', 'vu');
      const offer = await createOffer(user.accessToken);
      await castVote(user.accessToken, offer, 'UP');

      const res = await request(app.getHttpServer())
        .get('/users/me/votes')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(200);
      const body = res.body as Paginated<MyVoteBody>;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('UP');
      expect(body.items[0].offer).toEqual({
        id: offer,
        title: 'An offer',
        score: 1,
      });
      expect(body.nextCursor).toBeNull();
    });
  });
});
