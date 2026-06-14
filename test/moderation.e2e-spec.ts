import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  OfferStatus,
  ReportReason,
  ReportStatus,
  UserRole,
} from '@prisma/client';
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

type CommentModerationBody = {
  id: string;
  content: string;
  reportCount: number;
  hiddenAt: string | null;
  createdAt: string;
  user: { id: string; username: string };
  offer: { id: string; title: string };
};

type CommentModerationListBody = {
  items: CommentModerationBody[];
  nextCursor: string | null;
};

type ThreadItem = {
  id: string;
  content: string | null;
  hidden: boolean;
  deleted: boolean;
};

type ThreadListBody = { items: ThreadItem[]; nextCursor: string | null };

type OfferDetailBody = { id: string; commentCount: number };

type ReportDetailBody = {
  id: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  user: { id: string; username: string };
};

type ReportDetailListBody = {
  items: ReportDetailBody[];
  nextCursor: string | null;
};

type ModerationLogEntryBody = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  note: string | null;
  createdAt: string;
  actor: { id: string; username: string };
};

type ModerationLogListBody = {
  items: ModerationLogEntryBody[];
  nextCursor: string | null;
};

type ModerationSummaryBody = {
  pendingComments: number;
  pendingOfferReports: number;
};

type AdminUserBody = {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
};

type AdminUserListBody = {
  items: AdminUserBody[];
  nextCursor: string | null;
};

type AdminUserDetailBody = AdminUserBody & {
  counts: { offers: number; comments: number };
  moderationHistory: {
    action: string;
    reason: string | null;
    actor: { username: string };
  }[];
};

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
  merchantName: 'Acme',
  location: { address: 'Carrera 7', city: 'Bogotá' },
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Moderation flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let categoryId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

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
      .send({
        ...validOfferPayload(),
        categoryIds: [categoryId],
        ...overrides,
      });
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

    it('dismiss keeps reports as history and the same reporters re-trigger REPORTED via re-open', async () => {
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

      // Admin dismisses: offer back to ACTIVE, reportCount cleared
      const dismissed = await request(app.getHttpServer())
        .patch(`/admin/offers/${offer.id}/dismiss`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(dismissed.status).toBe(200);
      expect((dismissed.body as OfferBody).status).toBe('ACTIVE');
      expect((dismissed.body as OfferBody).reportCount).toBe(0);

      // Reports are kept as history (DISMISSED), not purged
      const remaining = await prisma.report.count({
        where: { offerId: offer.id },
      });
      expect(remaining).toBe(3);
      const pending = await prisma.report.count({
        where: { offerId: offer.id, status: ReportStatus.PENDING },
      });
      expect(pending).toBe(0);

      // Second round: the SAME reporters re-report -> reports re-open -> REPORTED
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

  describe('Comment moderation', () => {
    function postComment(
      token: string,
      offerId: string,
      content: string,
      parentId?: string,
    ) {
      return request(app.getHttpServer())
        .post(`/offers/${offerId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content, parentId });
    }

    function reportComment(
      token: string,
      offerId: string,
      commentId: string,
      reason = 'SPAM',
    ) {
      return request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${commentId}/reports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason });
    }

    // COMMENT_REPORT_THRESHOLD is 2 in tests: two distinct reporters flag it.
    async function flagComment(offerId: string, commentId: string) {
      const r1 = await registerUser('rep1@example.com', 'rep1');
      const r2 = await registerUser('rep2@example.com', 'rep2');
      await reportComment(r1.accessToken, offerId, commentId);
      await reportComment(r2.accessToken, offerId, commentId);
    }

    describe('Authorization', () => {
      it('rejects /admin/comments without authentication with 401', async () => {
        const res = await request(app.getHttpServer()).get('/admin/comments');
        expect(res.status).toBe(401);
      });

      it('rejects /admin/comments as a regular USER with 403', async () => {
        const user = await registerUser('user@example.com', 'user');
        const res = await request(app.getHttpServer())
          .get('/admin/comments')
          .set('Authorization', `Bearer ${user.accessToken}`);
        expect(res.status).toBe(403);
        expect((res.body as ErrorBody).key).toBe('auth.forbidden');
      });

      it('allows /admin/comments as ADMIN', async () => {
        const admin = await registerAdmin('admin@example.com', 'admin');
        const res = await request(app.getHttpServer())
          .get('/admin/comments')
          .set('Authorization', `Bearer ${admin.accessToken}`);
        expect(res.status).toBe(200);
      });
    });

    it('lists comments that crossed the report threshold', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await postComment(author.accessToken, offer.id, 'spam!');
      const commentId = (created.body as { id: string }).id;

      await flagComment(offer.id, commentId);

      const queue = await request(app.getHttpServer())
        .get('/admin/comments')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const body = queue.body as CommentModerationListBody;

      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: commentId,
        reportCount: 2,
        content: 'spam!',
        user: { username: 'author' },
        offer: { id: offer.id },
      });
    });

    it('hides a reported comment: masked in the thread, dropped from the queue, commentCount adjusted', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const root = await postComment(author.accessToken, offer.id, 'bad root');
      const rootId = (root.body as { id: string }).id;
      // a reply keeps the thread alive so the hidden root shows as a tombstone
      await postComment(author.accessToken, offer.id, 'a reply', rootId);
      await flagComment(offer.id, rootId);

      const hidden = await request(app.getHttpServer())
        .patch(`/admin/comments/${rootId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(hidden.status).toBe(200);
      expect((hidden.body as CommentModerationBody).hiddenAt).not.toBeNull();

      // masked (content null, hidden flag) in the public thread
      const thread = await request(app.getHttpServer()).get(
        `/offers/${offer.id}/comments`,
      );
      const root2 = (thread.body as ThreadListBody).items.find(
        (c) => c.id === rootId,
      );
      expect(root2?.content).toBeNull();
      expect(root2?.hidden).toBe(true);

      // gone from the moderation queue
      const queue = await request(app.getHttpServer())
        .get('/admin/comments')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect((queue.body as CommentModerationListBody).items).toHaveLength(0);

      // commentCount dropped (root no longer counted, reply still counts)
      const detail = await request(app.getHttpServer()).get(
        `/offers/${offer.id}`,
      );
      expect((detail.body as OfferDetailBody).commentCount).toBe(1);
    });

    it('restores a hidden comment: visible again and reports purged', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await postComment(author.accessToken, offer.id, 'oops');
      const commentId = (created.body as { id: string }).id;
      await flagComment(offer.id, commentId);
      await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      const restored = await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/restore`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(restored.status).toBe(200);
      expect((restored.body as CommentModerationBody).hiddenAt).toBeNull();
      expect((restored.body as CommentModerationBody).reportCount).toBe(0);

      // visible again with its content in the thread
      const thread = await request(app.getHttpServer()).get(
        `/offers/${offer.id}/comments`,
      );
      const item = (thread.body as ThreadListBody).items.find(
        (c) => c.id === commentId,
      );
      expect(item?.content).toBe('oops');
      expect(item?.hidden).toBe(false);
    });

    it('rejects reporting a moderator-hidden comment with comment.not_reportable', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await postComment(author.accessToken, offer.id, 'gone');
      const commentId = (created.body as { id: string }).id;
      await flagComment(offer.id, commentId);
      await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      const later = await registerUser('late@example.com', 'late');
      const res = await reportComment(later.accessToken, offer.id, commentId);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).key).toBe('comment.not_reportable');
    });

    it('rejects hiding an already hidden comment with comment.invalid_status_transition', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await postComment(author.accessToken, offer.id, 'x');
      const commentId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      const res = await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).key).toBe(
        'comment.invalid_status_transition',
      );
    });

    it('dismisses a reported comment: drops from the queue, stays visible, reports kept as DISMISSED', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await postComment(author.accessToken, offer.id, 'fine');
      const commentId = (created.body as { id: string }).id;
      await flagComment(offer.id, commentId);

      const dismissed = await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/dismiss`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(dismissed.status).toBe(200);

      // dropped from the moderation queue
      const queue = await request(app.getHttpServer())
        .get('/admin/comments')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect((queue.body as CommentModerationListBody).items).toHaveLength(0);

      // still visible with its content in the thread
      const thread = await request(app.getHttpServer()).get(
        `/offers/${offer.id}/comments`,
      );
      const item = (thread.body as ThreadListBody).items.find(
        (c) => c.id === commentId,
      );
      expect(item?.content).toBe('fine');
      expect(item?.hidden).toBe(false);

      // reports are kept as history, marked DISMISSED
      const reports = await request(app.getHttpServer())
        .get(`/admin/comments/${commentId}/reports`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const reportItems = (reports.body as ReportDetailListBody).items;
      expect(reportItems).toHaveLength(2);
      expect(reportItems.every((r) => r.status === 'DISMISSED')).toBe(true);
    });
  });

  describe('Report details', () => {
    it('lists a comment reports with reason, note and reporter', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('rep@example.com', 'rep');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/comments`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content: 'reported' });
      const commentId = (created.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/offers/${offer.id}/comments/${commentId}/reports`)
        .set('Authorization', `Bearer ${reporter.accessToken}`)
        .send({ reason: 'ABUSE', note: 'insulting' });

      const res = await request(app.getHttpServer())
        .get(`/admin/comments/${commentId}/reports`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(200);
      const body = res.body as ReportDetailListBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        reason: 'ABUSE',
        note: 'insulting',
        user: { username: 'rep' },
      });
    });

    it('lists an offer reports with the report text mapped to note', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('rep@example.com', 'rep');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      await request(app.getHttpServer())
        .post(`/offers/${offer.id}/reports`)
        .set('Authorization', `Bearer ${reporter.accessToken}`)
        .send({ reason: 'SCAM', comment: 'fake deal' });

      const res = await request(app.getHttpServer())
        .get(`/admin/offers/${offer.id}/reports`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(200);
      const body = res.body as ReportDetailListBody;
      expect(body.items[0]).toMatchObject({
        reason: 'SCAM',
        note: 'fake deal',
        user: { username: 'rep' },
      });
    });

    it('rejects listing reports of a missing comment with 404', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');
      const res = await request(app.getHttpServer())
        .get('/admin/comments/00000000-0000-0000-0000-000000000000/reports')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).key).toBe('comment.not_found');
    });
  });

  describe('Moderation log', () => {
    it('rejects /admin/moderation/log as a regular USER with 403', async () => {
      const user = await registerUser('user@example.com', 'user');
      const res = await request(app.getHttpServer())
        .get('/admin/moderation/log')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('records a moderation decision with its actor, action and reason', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);
      const created = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/comments`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content: 'bad comment' });
      const commentId = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/admin/comments/${commentId}/hide`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'spam', note: 'obvious ad' })
        .expect(200);

      const log = await request(app.getHttpServer())
        .get('/admin/moderation/log')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(log.status).toBe(200);

      const entry = (log.body as ModerationLogListBody).items.find(
        (e) => e.targetId === commentId,
      );
      expect(entry).toMatchObject({
        action: 'HIDE_COMMENT',
        targetType: 'COMMENT',
        targetId: commentId,
        reason: 'spam',
        note: 'obvious ad',
        actor: { username: 'admin' },
      });
    });
  });

  describe('Moderation summary', () => {
    it('rejects /admin/moderation/summary as a regular USER with 403', async () => {
      const user = await registerUser('user@example.com', 'user');
      const res = await request(app.getHttpServer())
        .get('/admin/moderation/summary')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('counts the pending comment queue and pending offer reports', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offer = await createOfferAs(author.accessToken);

      // a reported comment that crossed COMMENT_REPORT_THRESHOLD (2)
      const created = await request(app.getHttpServer())
        .post(`/offers/${offer.id}/comments`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content: 'reported' });
      const commentId = (created.body as { id: string }).id;
      const c1 = await registerUser('c1@example.com', 'c1');
      const c2 = await registerUser('c2@example.com', 'c2');
      for (const u of [c1, c2]) {
        await request(app.getHttpServer())
          .post(`/offers/${offer.id}/comments/${commentId}/reports`)
          .set('Authorization', `Bearer ${u.accessToken}`)
          .send({ reason: 'SPAM' });
      }

      // three pending reports on the offer (REPORT_THRESHOLD is 3)
      const o1 = await registerUser('o1@example.com', 'o1');
      const o2 = await registerUser('o2@example.com', 'o2');
      const o3 = await registerUser('o3@example.com', 'o3');
      for (const u of [o1, o2, o3]) {
        await request(app.getHttpServer())
          .post(`/offers/${offer.id}/reports`)
          .set('Authorization', `Bearer ${u.accessToken}`)
          .send({ reason: ReportReason.SCAM });
      }

      const res = await request(app.getHttpServer())
        .get('/admin/moderation/summary')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body as ModerationSummaryBody).toEqual({
        pendingComments: 1,
        pendingOfferReports: 3,
      });
    });
  });

  describe('Admin users', () => {
    it('rejects /admin/users as a regular USER with 403', async () => {
      const user = await registerUser('user@example.com', 'user');
      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('searches users by username', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');
      await registerUser('alice@example.com', 'alice');
      await registerUser('bob@example.com', 'bob');

      const res = await request(app.getHttpServer())
        .get('/admin/users?search=alic')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(200);
      const items = (res.body as AdminUserListBody).items;
      expect(items).toHaveLength(1);
      expect(items[0].username).toBe('alice');
    });

    it('returns a user detail with content counts and moderation history', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');
      const target = await registerUser('target@example.com', 'target');
      const offer = await createOfferAs(target.accessToken);
      await request(app.getHttpServer())
        .post(`/offers/${offer.id}/comments`)
        .set('Authorization', `Bearer ${target.accessToken}`)
        .send({ content: 'a comment' });

      // a sanction is recorded in the moderation log
      await request(app.getHttpServer())
        .patch(`/admin/users/${target.user.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'repeated abuse' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/admin/users/${target.user.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(200);
      const body = res.body as AdminUserDetailBody;
      expect(body).toMatchObject({
        id: target.user.id,
        username: 'target',
        status: 'DISABLED',
        counts: { offers: 1, comments: 1 },
      });
      expect(body.moderationHistory[0]).toMatchObject({
        action: 'DISABLE_USER',
        reason: 'repeated abuse',
        actor: { username: 'admin' },
      });
    });

    it('returns 404 user.not_found for an unknown user', async () => {
      const admin = await registerAdmin('admin@example.com', 'admin');
      const res = await request(app.getHttpServer())
        .get('/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).key).toBe('user.not_found');
    });
  });
});
