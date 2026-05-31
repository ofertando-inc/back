import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, ReportReason, UserRole, VoteType } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  user: { id: string };
};

type OfferBody = {
  id: string;
  status: string;
};

type ListBody = {
  items: OfferBody[];
  nextCursor: string | null;
};

type ErrorBody = { key: string; statusCode: number };

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
  title: 'Expiring offer',
  description: 'A very compelling description for expiration tests',
  offerType: 'discount',
  storeName: 'Acme',
  city: 'Bogotá',
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Offer expiration flow (e2e)', () => {
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

  async function createOfferAs(token: string): Promise<OfferBody> {
    const response = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send(validOfferPayload());
    return response.body as OfferBody;
  }

  // The CreateOfferDto rejects past endDates, so we push the date into the
  // past directly in the DB to simulate an offer that has outlived its window.
  function expireDateInDb(offerId: string): Promise<unknown> {
    return prisma.offer.update({
      where: { id: offerId },
      data: { endDate: new Date('2000-01-01T00:00:00Z') },
    });
  }

  describe('Public visibility (greyed, not hidden)', () => {
    it('keeps an EXPIRED offer visible in the public list', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);
      await prisma.offer.update({
        where: { id: offer.id },
        data: { status: OfferStatus.EXPIRED },
      });

      const res = await request(app.getHttpServer()).get('/offers');
      const body = res.body as ListBody;

      expect(res.status).toBe(200);
      expect(body.items.map((o) => o.id)).toContain(offer.id);
      expect(body.items.find((o) => o.id === offer.id)?.status).toBe('EXPIRED');
    });

    it('flips an ACTIVE offer past its endDate to EXPIRED on public detail read', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);
      await expireDateInDb(offer.id);

      const res = await request(app.getHttpServer()).get(`/offers/${offer.id}`);
      const body = res.body as OfferBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('EXPIRED');

      const stored = await prisma.offer.findUnique({ where: { id: offer.id } });
      expect(stored?.status).toBe(OfferStatus.EXPIRED);
    });
  });

  describe('Actions blocked past endDate', () => {
    it('rejects voting on an offer past its endDate', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('voter@example.com', 'voter');
      const offer = await createOfferAs(author.accessToken);
      await expireDateInDb(offer.id);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .send({ type: VoteType.UP });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('vote.offer_not_voteable');
    });

    it('rejects reporting on an offer past its endDate', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);
      await expireDateInDb(offer.id);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/reports`)
        .set('Authorization', `Bearer ${reporter.accessToken}`)
        .send({ reason: ReportReason.OTHER });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('report.offer_not_reportable');
    });
  });

  describe('POST /admin/offers/expire-now', () => {
    it('rejects non-admin callers with 403', async () => {
      const user = await registerUser('user@example.com', 'user');

      const res = await request(app.getHttpServer())
        .post('/admin/offers/expire-now')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(res.status).toBe(403);
    });

    it('flips outdated ACTIVE offers to EXPIRED and returns the count', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const outdated = await createOfferAs(author.accessToken);
      const fresh = await createOfferAs(author.accessToken);
      await expireDateInDb(outdated.id);

      const res = await request(app.getHttpServer())
        .post('/admin/offers/expire-now')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as { expired: number };

      expect(res.status).toBe(200);
      expect(body.expired).toBe(1);

      const outdatedStored = await prisma.offer.findUnique({
        where: { id: outdated.id },
      });
      const freshStored = await prisma.offer.findUnique({
        where: { id: fresh.id },
      });
      expect(outdatedStored?.status).toBe(OfferStatus.EXPIRED);
      expect(freshStored?.status).toBe(OfferStatus.ACTIVE);
    });
  });
});
