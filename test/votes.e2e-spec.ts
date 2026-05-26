import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  user: { id: string; email: string };
};

type OfferBody = {
  id: string;
  title: string;
  status: string;
  score: number;
  createdById: string;
};

type VoteBody = {
  score: number;
  userVote: 'UP' | 'DOWN' | null;
};

type UserVoteBody = {
  type: 'UP' | 'DOWN' | null;
};

type ErrorBody = {
  key: string;
  statusCode: number;
};

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

const validOfferPayload = () => ({
  title: 'Big discount',
  description: 'A very compelling discount description',
  offerType: 'discount',
  storeName: 'Acme',
  city: 'Bogotá',
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Votes flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
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

  async function createOfferAs(
    token: string,
    overrides: Partial<ReturnType<typeof validOfferPayload>> = {},
  ): Promise<OfferBody> {
    const response = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validOfferPayload(), ...overrides });
    return response.body as OfferBody;
  }

  function setOfferStatus(
    offerId: string,
    status: OfferStatus,
  ): Promise<unknown> {
    return prisma.offer.update({ where: { id: offerId }, data: { status } });
  }

  function cast(token: string, offerId: string, type: 'UP' | 'DOWN') {
    return request(app.getHttpServer())
      .post(`/offers/${offerId}/votes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type });
  }

  function withdraw(token: string, offerId: string) {
    return request(app.getHttpServer())
      .delete(`/offers/${offerId}/votes`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getMine(token: string, offerId: string) {
    return request(app.getHttpServer())
      .get(`/offers/${offerId}/votes/me`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('POST /offers/:offerId/votes', () => {
    it('casts an UP vote and increments the offer score', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      const res = await cast(voter.accessToken, offer.id, 'UP');
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 1, userVote: 'UP' });
    });

    it('casts a DOWN vote and decrements the offer score', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      const res = await cast(voter.accessToken, offer.id, 'DOWN');
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: -1, userVote: 'DOWN' });
    });

    it('is idempotent when the same vote is cast twice', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      await cast(voter.accessToken, offer.id, 'UP');
      const res = await cast(voter.accessToken, offer.id, 'UP');
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 1, userVote: 'UP' });
    });

    it('switches UP to DOWN with a -2 score delta', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      await cast(voter.accessToken, offer.id, 'UP');
      const res = await cast(voter.accessToken, offer.id, 'DOWN');
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: -1, userVote: 'DOWN' });
    });

    it('allows the author to vote on their own offer', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await cast(author.accessToken, offer.id, 'UP');
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 1, userVote: 'UP' });
    });

    it('rejects without auth with auth.unauthorized', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/votes`)
        .send({ type: 'UP' });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it.each([OfferStatus.REPORTED, OfferStatus.DISABLED, OfferStatus.EXPIRED])(
      'rejects voting on a %s offer with vote.offer_not_voteable',
      async (status) => {
        const author = await registerUser('author@example.com', 'author');
        const voter = await registerUser('voter@example.com', 'voter');
        const offer = await createOfferAs(author.accessToken);
        await setOfferStatus(offer.id, status);

        const res = await cast(voter.accessToken, offer.id, 'UP');
        const body = res.body as ErrorBody;

        expect(res.status).toBe(400);
        expect(body.key).toBe('vote.offer_not_voteable');
      },
    );

    it('returns offer.not_found when the offer is DELETED', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.DELETED);

      const res = await cast(voter.accessToken, offer.id, 'UP');
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });

    it('returns offer.not_found when the offer does not exist', async () => {
      const voter = await registerUser('voter@example.com', 'voter');

      const res = await cast(
        voter.accessToken,
        '00000000-0000-0000-0000-000000000000',
        'UP',
      );
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });
  });

  describe('DELETE /offers/:offerId/votes', () => {
    it('withdraws an existing UP vote and restores the score', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      await cast(voter.accessToken, offer.id, 'UP');
      const res = await withdraw(voter.accessToken, offer.id);
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 0, userVote: null });
    });

    it('withdraws an existing DOWN vote and restores the score', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      await cast(voter.accessToken, offer.id, 'DOWN');
      const res = await withdraw(voter.accessToken, offer.id);
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 0, userVote: null });
    });

    it('is idempotent when no vote exists', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      const res = await withdraw(voter.accessToken, offer.id);
      const body = res.body as VoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ score: 0, userVote: null });
    });

    it('rejects without auth', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer()).delete(
        `/offers/${offer.id}/votes`,
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /offers/:offerId/votes/me', () => {
    it('returns the vote type when the user has voted', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);
      await cast(voter.accessToken, offer.id, 'DOWN');

      const res = await getMine(voter.accessToken, offer.id);
      const body = res.body as UserVoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ type: 'DOWN' });
    });

    it('returns null when the user has not voted', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);

      const res = await getMine(voter.accessToken, offer.id);
      const body = res.body as UserVoteBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ type: null });
    });

    it('rejects without auth', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer()).get(
        `/offers/${offer.id}/votes/me`,
      );

      expect(res.status).toBe(401);
    });
  });

  describe('Offer score reflects votes from multiple users', () => {
    it('aggregates UP/DOWN votes across users', async () => {
      const author = await registerUser('author@example.com', 'author');
      const u1 = await registerUser('u1@example.com', 'u1');
      const u2 = await registerUser('u2@example.com', 'u2');
      const u3 = await registerUser('u3@example.com', 'u3');
      const offer = await createOfferAs(author.accessToken);

      await cast(u1.accessToken, offer.id, 'UP');
      await cast(u2.accessToken, offer.id, 'UP');
      await cast(u3.accessToken, offer.id, 'DOWN');

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      const body = detail.body as OfferBody;

      expect(detail.status).toBe(200);
      expect(body.score).toBe(1);
    });
  });
});
