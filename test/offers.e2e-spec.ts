import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    status: string;
  };
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

type OfferBody = {
  id: string;
  title: string;
  description: string;
  status: string;
  createdById: string;
  city: string;
  offerType: string;
};

type ListBody = {
  items: OfferBody[];
  nextCursor: string | null;
};

type ErrorBody = {
  key: string;
  statusCode: number;
  details?: Record<string, unknown>;
};

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

describe('Offers flow (e2e)', () => {
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

  async function registerAdmin(
    email: string,
    username: string,
  ): Promise<RegisteredUser> {
    const registered = await registerUser(email, username);
    await prisma.user.update({
      where: { id: registered.user.id },
      data: { role: UserRole.ADMIN },
    });
    return registered;
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

  describe('POST /offers', () => {
    it('creates an offer for an authenticated user', async () => {
      const author = await registerUser('author@example.com', 'author');

      const response = await request(app.getHttpServer())
        .post('/offers')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send(validOfferPayload());
      const body = response.body as OfferBody;

      expect(response.status).toBe(201);
      expect(body).toMatchObject({
        title: 'Big discount',
        status: 'ACTIVE',
        createdById: author.user.id,
      });
    });

    it('rejects creation without a token with auth.unauthorized', async () => {
      const response = await request(app.getHttpServer())
        .post('/offers')
        .send(validOfferPayload());
      const body = response.body as ErrorBody;

      expect(response.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('rejects when endDate is before startDate with offer.invalid_dates', async () => {
      const author = await registerUser('author@example.com', 'author');

      const response = await request(app.getHttpServer())
        .post('/offers')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({
          ...validOfferPayload(),
          startDate: futureIso(7),
          endDate: futureIso(1),
        });
      const body = response.body as ErrorBody;

      expect(response.status).toBe(400);
      expect(body.key).toBe('offer.invalid_dates');
    });
  });

  describe('GET /offers', () => {
    it('returns active offers paginated with nextCursor when there is more', async () => {
      const author = await registerUser('author@example.com', 'author');
      await createOfferAs(author.accessToken, { title: 'A' });
      await createOfferAs(author.accessToken, { title: 'B' });
      await createOfferAs(author.accessToken, { title: 'C' });

      const first = await request(app.getHttpServer()).get('/offers?limit=2');
      const firstBody = first.body as ListBody;

      expect(first.status).toBe(200);
      expect(firstBody.items).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer()).get(
        `/offers?limit=2&cursor=${firstBody.nextCursor as string}`,
      );
      const secondBody = second.body as ListBody;

      expect(second.status).toBe(200);
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
    });

    it('filters by city', async () => {
      const author = await registerUser('author@example.com', 'author');
      await createOfferAs(author.accessToken, { city: 'Bogotá' });
      await createOfferAs(author.accessToken, { city: 'Medellín' });

      const response = await request(app.getHttpServer()).get(
        '/offers?city=Medell%C3%ADn',
      );
      const body = response.body as ListBody;

      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].city).toBe('Medellín');
    });

    it('rejects an invalid cursor with pagination.invalid_cursor', async () => {
      const response = await request(app.getHttpServer()).get(
        '/offers?cursor=not-a-base64-cursor',
      );
      const body = response.body as ErrorBody;

      expect(response.status).toBe(400);
      expect(body.key).toBe('pagination.invalid_cursor');
    });
  });

  describe('GET /offers/:id', () => {
    it('returns a single active offer', async () => {
      const author = await registerUser('author@example.com', 'author');
      const created = await createOfferAs(author.accessToken);

      const response = await request(app.getHttpServer()).get(
        `/offers/${created.id}`,
      );
      const body = response.body as OfferBody;

      expect(response.status).toBe(200);
      expect(body.id).toBe(created.id);
    });

    it('returns offer.not_found for an unknown id', async () => {
      const response = await request(app.getHttpServer()).get(
        '/offers/00000000-0000-0000-0000-000000000000',
      );
      const body = response.body as ErrorBody;

      expect(response.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });
  });

  describe('PATCH /offers/:id', () => {
    it('lets the owner update their offer', async () => {
      const author = await registerUser('author@example.com', 'author');
      const created = await createOfferAs(author.accessToken);

      const response = await request(app.getHttpServer())
        .patch(`/offers/${created.id}`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ title: 'Updated title' });
      const body = response.body as OfferBody;

      expect(response.status).toBe(200);
      expect(body.title).toBe('Updated title');
    });

    it('lets an admin update any offer', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const created = await createOfferAs(author.accessToken);

      const response = await request(app.getHttpServer())
        .patch(`/offers/${created.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ title: 'Admin override' });
      const body = response.body as OfferBody;

      expect(response.status).toBe(200);
      expect(body.title).toBe('Admin override');
    });

    it('rejects a non-owner with offer.forbidden', async () => {
      const author = await registerUser('author@example.com', 'author');
      const stranger = await registerUser('stranger@example.com', 'stranger');
      const created = await createOfferAs(author.accessToken);

      const response = await request(app.getHttpServer())
        .patch(`/offers/${created.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ title: 'Hack' });
      const body = response.body as ErrorBody;

      expect(response.status).toBe(403);
      expect(body.key).toBe('offer.forbidden');
    });

    it('returns offer.not_found when targeting an unknown id', async () => {
      const stranger = await registerUser('stranger@example.com', 'stranger');

      const response = await request(app.getHttpServer())
        .patch('/offers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ title: 'X' });
      const body = response.body as ErrorBody;

      expect(response.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });
  });

  describe('DELETE /offers/:id', () => {
    it('soft-deletes the offer and hides it from the public detail route', async () => {
      const author = await registerUser('author@example.com', 'author');
      const created = await createOfferAs(author.accessToken);

      const del = await request(app.getHttpServer())
        .delete(`/offers/${created.id}`)
        .set('Authorization', `Bearer ${author.accessToken}`);

      expect(del.status).toBe(204);

      const detail = await request(app.getHttpServer()).get(
        `/offers/${created.id}`,
      );
      const detailBody = detail.body as ErrorBody;

      expect(detail.status).toBe(404);
      expect(detailBody.key).toBe('offer.not_found');
    });

    it('rejects a non-owner delete with offer.forbidden', async () => {
      const author = await registerUser('author@example.com', 'author');
      const stranger = await registerUser('stranger@example.com', 'stranger');
      const created = await createOfferAs(author.accessToken);

      const response = await request(app.getHttpServer())
        .delete(`/offers/${created.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`);
      const body = response.body as ErrorBody;

      expect(response.status).toBe(403);
      expect(body.key).toBe('offer.forbidden');
    });
  });

  describe('GET /offers/mine', () => {
    it('requires auth', async () => {
      const response = await request(app.getHttpServer()).get('/offers/mine');
      const body = response.body as ErrorBody;

      expect(response.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('returns only offers owned by the caller', async () => {
      const author = await registerUser('author@example.com', 'author');
      const stranger = await registerUser('stranger@example.com', 'stranger');
      await createOfferAs(author.accessToken, { title: 'Mine A' });
      await createOfferAs(author.accessToken, { title: 'Mine B' });
      await createOfferAs(stranger.accessToken, { title: 'Theirs' });

      const response = await request(app.getHttpServer())
        .get('/offers/mine')
        .set('Authorization', `Bearer ${author.accessToken}`);
      const body = response.body as ListBody;

      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(2);
      expect(body.items.every((o) => o.createdById === author.user.id)).toBe(
        true,
      );
    });
  });
});
