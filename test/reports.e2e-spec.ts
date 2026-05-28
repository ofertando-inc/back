import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, ReportReason } from '@prisma/client';
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
  createdById: string;
};

type ReportBody = {
  status: 'ACTIVE' | 'REPORTED' | 'DISABLED' | 'DELETED' | 'EXPIRED';
};

type UserReportBody = {
  reason: ReportReason | null;
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
  title: 'Reportable offer',
  description: 'A very compelling description',
  offerType: 'discount',
  storeName: 'Acme',
  city: 'Bogotá',
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Reports flow (e2e)', () => {
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

  function reportOffer(
    token: string,
    offerId: string,
    body: { reason: ReportReason; comment?: string } = {
      reason: ReportReason.OTHER,
    },
  ) {
    return request(app.getHttpServer())
      .post(`/offers/${offerId}/reports`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function getMyReport(token: string, offerId: string) {
    return request(app.getHttpServer())
      .get(`/offers/${offerId}/reports/me`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('POST /offers/:offerId/reports', () => {
    it('creates a report and keeps the offer ACTIVE below threshold', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);

      const res = await reportOffer(reporter.accessToken, offer.id, {
        reason: ReportReason.SCAM,
        comment: 'looks fake',
      });
      const body = res.body as ReportBody;

      expect(res.status).toBe(201);
      expect(body).toEqual({ status: 'ACTIVE' });
    });

    it('transitions the offer to REPORTED once the threshold is reached', async () => {
      const author = await registerUser('author@example.com', 'author');
      const r1 = await registerUser('r1@example.com', 'r1');
      const r2 = await registerUser('r2@example.com', 'r2');
      const r3 = await registerUser('r3@example.com', 'r3');
      const offer = await createOfferAs(author.accessToken);

      await reportOffer(r1.accessToken, offer.id);
      await reportOffer(r2.accessToken, offer.id);
      const last = await reportOffer(r3.accessToken, offer.id);
      const lastBody = last.body as ReportBody;

      expect(last.status).toBe(201);
      expect(lastBody.status).toBe('REPORTED');

      const updated = await prisma.offer.findUnique({
        where: { id: offer.id },
      });
      expect(updated?.status).toBe(OfferStatus.REPORTED);
      expect(updated?.reportCount).toBe(3);
    });

    it('is idempotent when the same user reports twice', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);

      await reportOffer(reporter.accessToken, offer.id);
      const second = await reportOffer(reporter.accessToken, offer.id);
      const body = second.body as ReportBody;

      expect(second.status).toBe(201);
      expect(body).toEqual({ status: 'ACTIVE' });

      const stored = await prisma.offer.findUnique({ where: { id: offer.id } });
      expect(stored?.reportCount).toBe(1);
    });

    it('still accepts reports on an offer already REPORTED', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.REPORTED);

      const res = await reportOffer(reporter.accessToken, offer.id);
      const body = res.body as ReportBody;

      expect(res.status).toBe(201);
      expect(body.status).toBe('REPORTED');
    });

    it('rejects without auth with auth.unauthorized', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/reports`)
        .send({ reason: ReportReason.OTHER });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it.each([OfferStatus.DISABLED, OfferStatus.EXPIRED])(
      'rejects reporting on a %s offer with report.offer_not_reportable',
      async (status) => {
        const author = await registerUser('author@example.com', 'author');
        const reporter = await registerUser('reporter@example.com', 'reporter');
        const offer = await createOfferAs(author.accessToken);
        await setOfferStatus(offer.id, status);

        const res = await reportOffer(reporter.accessToken, offer.id);
        const body = res.body as ErrorBody;

        expect(res.status).toBe(400);
        expect(body.key).toBe('report.offer_not_reportable');
      },
    );

    it('returns offer.not_found when the offer is DELETED', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.DELETED);

      const res = await reportOffer(reporter.accessToken, offer.id);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });

    it('returns offer.not_found when the offer does not exist', async () => {
      const reporter = await registerUser('reporter@example.com', 'reporter');

      const res = await reportOffer(
        reporter.accessToken,
        '00000000-0000-0000-0000-000000000000',
      );
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });

    it('rejects an invalid reason with validation.failed', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/reports`)
        .set('Authorization', `Bearer ${reporter.accessToken}`)
        .send({ reason: 'NOT_A_REAL_REASON' });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('validation.failed');
    });
  });

  describe('GET /offers/:offerId/reports/me', () => {
    it('returns the reason when the user has reported', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);
      await reportOffer(reporter.accessToken, offer.id, {
        reason: ReportReason.INCORRECT_INFO,
      });

      const res = await getMyReport(reporter.accessToken, offer.id);
      const body = res.body as UserReportBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ reason: 'INCORRECT_INFO' });
    });

    it('returns null when the user has not reported', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const offer = await createOfferAs(author.accessToken);

      const res = await getMyReport(reporter.accessToken, offer.id);
      const body = res.body as UserReportBody;

      expect(res.status).toBe(200);
      expect(body).toEqual({ reason: null });
    });

    it('rejects without auth', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer()).get(
        `/offers/${offer.id}/reports/me`,
      );

      expect(res.status).toBe(401);
    });
  });
});
