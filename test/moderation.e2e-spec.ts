import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, ReportReason, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    status: string;
  };
};

type OfferBody = {
  id: string;
  title: string;
  status: string;
  score: number;
  reportCount: number;
  createdByUsername: string;
};

type UserBody = {
  id: string;
  status: string;
  role: string;
};

type ReportSummaryBody = {
  id: string;
  reason: ReportReason;
  comment: string | null;
  user: { id: string; username: string };
  offer: { id: string; title: string };
};

type ReportListBody = {
  items: ReportSummaryBody[];
  nextCursor: string | null;
};

type OfferListBody = {
  items: OfferBody[];
  nextCursor: string | null;
};

type ErrorBody = { key: string; statusCode: number };

function extractCookie(name: string, setCookieHeader: unknown): string {
  const cookies = Array.isArray(setCookieHeader)
    ? (setCookieHeader as string[])
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const prefix = `${name}=`;
  const cookie = cookies.find((c) => c.startsWith(prefix));
  return cookie?.split(';')[0]?.split('=')[1] ?? '';
}

function futureIso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000).toISOString();
}

const validOfferPayload = () => ({
  title: 'Moderation target',
  description: 'A very compelling description for moderation tests',
  offerType: 'discount',
  storeName: 'Acme',
  city: 'Bogotá',
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Moderation flow (e2e)', () => {
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
      accessToken: extractCookie(
        'access_token',
        response.headers['set-cookie'],
      ),
      refreshToken: extractCookie(
        'refresh_token',
        response.headers['set-cookie'],
      ),
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

  function setOfferStatus(
    offerId: string,
    status: OfferStatus,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    return prisma.offer.update({
      where: { id: offerId },
      data: { status, ...extra },
    });
  }

  describe('Authorization', () => {
    it('rejects /admin/offers without authentication with 401', async () => {
      const res = await request(app.getHttpServer()).get('/admin/offers');
      const body = res.body as ErrorBody;

      expect(res.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('rejects /admin/offers as a regular USER with 403 auth.forbidden', async () => {
      const user = await registerUser('user@example.com', 'user');

      const res = await request(app.getHttpServer())
        .get('/admin/offers')
        .set('Authorization', `Bearer ${user.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(403);
      expect(body.key).toBe('auth.forbidden');
    });

    it('allows /admin/offers as ADMIN', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');

      const res = await request(app.getHttpServer())
        .get('/admin/offers')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /admin/offers', () => {
    it('filters by status=REPORTED', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const a = await createOfferAs(author.accessToken, { title: 'A' });
      const b = await createOfferAs(author.accessToken, { title: 'B' });
      await setOfferStatus(b.id, OfferStatus.REPORTED);

      const res = await request(app.getHttpServer())
        .get('/admin/offers?status=REPORTED')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as OfferListBody;

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(b.id);
      expect(body.items[0].id).not.toBe(a.id);
    });
  });

  describe('PATCH /admin/offers/:id/disable', () => {
    it('disables an ACTIVE offer and hides it from public detail', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as OfferBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('DISABLED');

      const publicDetail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      expect(publicDetail.status).toBe(404);
    });

    it('also disables a REPORTED offer', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.REPORTED);

      const res = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as OfferBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('DISABLED');
    });

    it('rejects disabling a DELETED offer with offer.invalid_status_transition', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.DELETED);

      const res = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('offer.invalid_status_transition');
    });

    it('returns offer.not_found when the offer does not exist', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');

      const res = await request(app.getHttpServer())
        .patch('/admin/offers/00000000-0000-0000-0000-000000000000/disable')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('offer.not_found');
    });
  });

  describe('PATCH /admin/offers/:id/restore', () => {
    it('restores a DISABLED offer back to ACTIVE and resets reportCount', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      await setOfferStatus(offer.id, OfferStatus.DISABLED, {
        reportCount: 12,
        disabledAt: new Date(),
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as OfferBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('ACTIVE');
      expect(body.reportCount).toBe(0);
    });

    it('rejects restoring an ACTIVE offer with offer.invalid_status_transition', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);

      const res = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('offer.invalid_status_transition');
    });

    it('purges reports on restore so the same reporters can report again and re-trigger REPORTED', async () => {
      // REPORT_THRESHOLD is 3 in the test environment
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const r1 = await registerUser('r1@example.com', 'r1');
      const r2 = await registerUser('r2@example.com', 'r2');
      const r3 = await registerUser('r3@example.com', 'r3');
      const offer = await createOfferAs(author.accessToken);

      const report = (token: string) =>
        request(app.getHttpServer())
          .post(`/offers/${offer.id}/reports`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: ReportReason.SCAM });

      // First round: 3 reports -> REPORTED
      await report(r1.accessToken);
      await report(r2.accessToken);
      const firstTrigger = await report(r3.accessToken);
      expect((firstTrigger.body as { status: string }).status).toBe('REPORTED');

      // Admin reviews: disable then restore
      await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // Reports must be purged
      const remaining = await prisma.report.count({
        where: { offerId: offer.id },
      });
      expect(remaining).toBe(0);

      // Second round: the SAME reporters can report again and re-trigger REPORTED
      const r1Again = await report(r1.accessToken);
      expect(r1Again.status).toBe(201);
      await report(r2.accessToken);
      const secondTrigger = await report(r3.accessToken);
      expect((secondTrigger.body as { status: string }).status).toBe(
        'REPORTED',
      );

      const reloaded = await prisma.offer.findUnique({
        where: { id: offer.id },
      });
      expect(reloaded?.status).toBe(OfferStatus.REPORTED);
      expect(reloaded?.reportCount).toBe(3);
    });
  });

  describe('GET /admin/reports', () => {
    it('returns reports with user and offer joins', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('reporter@example.com', 'reporter');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken, {
        title: 'Reported one',
      });

      await request(app.getHttpServer())
        .post(`/offers/${offer.id}/reports`)
        .set('Authorization', `Bearer ${reporter.accessToken}`)
        .send({ reason: ReportReason.SCAM, comment: 'shady' });

      const res = await request(app.getHttpServer())
        .get('/admin/reports')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ReportListBody;

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        reason: 'SCAM',
        comment: 'shady',
        user: { id: reporter.user.id, username: 'reporter' },
        offer: { id: offer.id, title: 'Reported one' },
      });
    });
  });

  describe('PATCH /admin/users/:id/disable', () => {
    it('disables an ACTIVE user and kicks their existing access token', async () => {
      const target = await registerUser('target@example.com', 'target');
      const admin = await registerAdmin('admin@example.com', 'admin');

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as UserBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('DISABLED');

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${target.accessToken}`);
      const meBody = me.body as ErrorBody;

      expect(me.status).toBe(401);
      expect(meBody.key).toBe('auth.account_disabled');
    });

    it('revokes the disabled user refresh token so refresh fails with 401', async () => {
      const target = await registerUser('target@example.com', 'target');
      const admin = await registerAdmin('admin@example.com', 'admin');

      await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const refresh = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${target.refreshToken}`);

      expect(refresh.status).toBe(401);
    });

    it('rejects disabling an already DISABLED user with user.invalid_status_transition', async () => {
      const target = await registerUser('target@example.com', 'target');
      const admin = await registerAdmin('admin@example.com', 'admin');
      await prisma.user.update({
        where: { id: target.user.id },
        data: { status: 'DISABLED' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('user.invalid_status_transition');
    });

    it('returns user.not_found when the user does not exist', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');

      const res = await request(app.getHttpServer())
        .patch('/admin/users/00000000-0000-0000-0000-000000000000/disable')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(404);
      expect(body.key).toBe('user.not_found');
    });
  });

  describe('PATCH /admin/users/:id/restore', () => {
    it('restores a DISABLED user and lets them log in again', async () => {
      const target = await registerUser('target@example.com', 'target');
      const admin = await registerAdmin('admin@example.com', 'admin');
      await prisma.user.update({
        where: { id: target.user.id },
        data: { status: 'DISABLED' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as UserBody;

      expect(res.status).toBe(200);
      expect(body.status).toBe('ACTIVE');

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'target@example.com', password: 'password123' });

      expect(login.status).toBe(200);
    });

    it('rejects restoring an already ACTIVE user', async () => {
      const target = await registerUser('target@example.com', 'target');
      const admin = await registerAdmin('admin@example.com', 'admin');

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('user.invalid_status_transition');
    });
  });
});
