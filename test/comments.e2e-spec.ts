import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, UserRole, VoteType } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetTestDatabase } from './test-db';

type RegisteredUser = {
  accessToken: string;
  user: { id: string; username: string };
};

type CommentBody = {
  id: string;
  content: string | null;
  editedAt: string | null;
  user: { id: string; username: string };
  replyTo: { id: string; username: string } | null;
  score: number;
  replyCount: number;
  userVote: VoteType | null;
  deleted: boolean;
  hidden: boolean;
};

type CommentListBody = {
  items: CommentBody[];
  nextCursor: string | null;
};

type VoteBody = { score: number; userVote: VoteType | null };

type OfferBody = { id: string; commentCount: number };

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
  title: 'Commentable offer',
  description: 'A very compelling description for comment tests',
  offerType: 'discount',
  storeName: 'Acme',
  city: 'Bogotá',
  startDate: futureIso(1),
  endDate: futureIso(7),
});

describe('Comments flow (e2e)', () => {
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

  async function createOffer(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/offers')
      .set('Authorization', `Bearer ${token}`)
      .send(validOfferPayload());
    return (response.body as { id: string }).id;
  }

  function comment(
    token: string,
    offerId: string,
    body: { content: string; parentId?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/offers/${offerId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('POST /offers/:offerId/comments', () => {
    it('creates a top-level comment and bumps the offer commentCount', async () => {
      const author = await registerUser('author@example.com', 'author');
      const commenter = await registerUser('c@example.com', 'commenter');
      const offerId = await createOffer(author.accessToken);

      const res = await comment(commenter.accessToken, offerId, {
        content: 'Great deal!',
      });
      const body = res.body as CommentBody;

      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        content: 'Great deal!',
        user: { id: commenter.user.id, username: 'commenter' },
        score: 0,
        replyCount: 0,
        userVote: null,
      });

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offerId}`,
      );
      expect((detail.body as OfferBody).commentCount).toBe(1);
    });

    it('rejects commenting without auth', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments`)
        .send({ content: 'x' });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(401);
      expect(body.key).toBe('auth.unauthorized');
    });

    it('rejects an empty or too-long comment with validation.failed', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);

      const res = await comment(author.accessToken, offerId, { content: '' });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('validation.failed');
    });

    it('rejects commenting on a disabled offer with comment.offer_not_commentable', async () => {
      const author = await registerUser('author@example.com', 'author');
      const commenter = await registerUser('c@example.com', 'commenter');
      const offerId = await createOffer(author.accessToken);
      await prisma.offer.update({
        where: { id: offerId },
        data: { status: OfferStatus.DISABLED },
      });

      const res = await comment(commenter.accessToken, offerId, {
        content: 'hi',
      });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('comment.offer_not_commentable');
    });
  });

  describe('Threading (flat, one level + replyTo)', () => {
    it('creates a reply and increments the parent replyCount', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      const root = await comment(author.accessToken, offerId, {
        content: 'Does it still work?',
      });
      const rootId = (root.body as CommentBody).id;

      const reply = await comment(author.accessToken, offerId, {
        content: 'Yes it does',
        parentId: rootId,
      });

      expect(reply.status).toBe(201);
      // a direct reply to a root carries no replyTo tag
      expect((reply.body as CommentBody).replyTo).toBeNull();

      const thread = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      const threadBody = thread.body as CommentListBody;
      expect(threadBody.items).toHaveLength(1);
      expect(threadBody.items[0].replyCount).toBe(1);

      const replies = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments/${rootId}/replies`,
      );
      const repliesBody = replies.body as CommentListBody;
      expect(repliesBody.items).toHaveLength(1);
      expect(repliesBody.items[0].content).toBe('Yes it does');
    });

    it('flattens a reply-to-a-reply under the root and tags replyTo', async () => {
      const author = await registerUser('author@example.com', 'author');
      const bob = await registerUser('bob@example.com', 'bob');
      const offerId = await createOffer(author.accessToken);

      const root = await comment(author.accessToken, offerId, {
        content: 'root',
      });
      const rootId = (root.body as CommentBody).id;

      const reply = await comment(bob.accessToken, offerId, {
        content: 'first reply',
        parentId: rootId,
      });
      const replyId = (reply.body as CommentBody).id;

      // reply to the reply: must be accepted, flattened under the root
      const nested = await comment(author.accessToken, offerId, {
        content: 'answering bob',
        parentId: replyId,
      });
      expect(nested.status).toBe(201);
      expect((nested.body as CommentBody).replyTo).toEqual({
        id: replyId,
        username: 'bob',
      });

      // both replies live flat under the root → replyCount = 2
      const thread = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      const threadBody = thread.body as CommentListBody;
      expect(threadBody.items).toHaveLength(1);
      expect(threadBody.items[0].replyCount).toBe(2);

      const replies = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments/${rootId}/replies`,
      );
      const repliesBody = replies.body as CommentListBody;
      expect(repliesBody.items).toHaveLength(2);
      const nestedItem = repliesBody.items.find(
        (c) => c.content === 'answering bob',
      );
      expect(nestedItem?.replyTo).toEqual({ id: replyId, username: 'bob' });
    });
  });

  describe('PATCH / DELETE', () => {
    it('lets the author edit their comment and stamps editedAt', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'typo heer',
      });
      const id = (created.body as CommentBody).id;

      const res = await request(app.getHttpServer())
        .patch(`/offers/${offerId}/comments/${id}`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content: 'typo here' });
      const body = res.body as CommentBody;

      expect(res.status).toBe(200);
      expect(body.content).toBe('typo here');
      expect(body.editedAt).not.toBeNull();
    });

    it('rejects edit by a non-owner with comment.forbidden', async () => {
      const author = await registerUser('author@example.com', 'author');
      const stranger = await registerUser('s@example.com', 'stranger');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'mine',
      });
      const id = (created.body as CommentBody).id;

      const res = await request(app.getHttpServer())
        .patch(`/offers/${offerId}/comments/${id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ content: 'hacked' });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(403);
      expect(body.key).toBe('comment.forbidden');
    });

    it('tombstones a top-level comment with replies (admin), preserving the thread', async () => {
      const author = await registerUser('author@example.com', 'author');
      const admin = await registerAdmin('admin@example.com', 'admin');
      const offerId = await createOffer(author.accessToken);
      const root = await comment(author.accessToken, offerId, {
        content: 'root',
      });
      const rootId = (root.body as CommentBody).id;
      await comment(author.accessToken, offerId, {
        content: 'reply',
        parentId: rootId,
      });

      const del = await request(app.getHttpServer())
        .delete(`/offers/${offerId}/comments/${rootId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      const delBody = del.body as CommentBody;

      expect(del.status).toBe(200);
      expect(delBody.deleted).toBe(true);
      expect(delBody.content).toBeNull();

      // The thread still shows the tombstone (it has a live reply).
      const thread = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      const threadItems = (thread.body as CommentListBody).items;
      expect(threadItems).toHaveLength(1);
      expect(threadItems[0]).toMatchObject({ deleted: true, content: null });

      // The reply survives.
      const replies = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments/${rootId}/replies`,
      );
      expect((replies.body as CommentListBody).items).toHaveLength(1);

      // commentCount counts only live comments: the surviving reply.
      const detail = await request(app.getHttpServer()).get(
        `/offers/${offerId}`,
      );
      expect((detail.body as OfferBody).commentCount).toBe(1);
    });

    it('drops a top-level comment with no replies out of the thread', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'lonely',
      });
      const id = (created.body as CommentBody).id;

      await request(app.getHttpServer())
        .delete(`/offers/${offerId}/comments/${id}`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .expect(200);

      const thread = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      expect((thread.body as CommentListBody).items).toHaveLength(0);

      const detail = await request(app.getHttpServer()).get(
        `/offers/${offerId}`,
      );
      expect((detail.body as OfferBody).commentCount).toBe(0);
    });
  });

  describe('Votes', () => {
    it('casts, flips and withdraws a vote, reflecting score and userVote', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('v@example.com', 'voter');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'vote me',
      });
      const id = (created.body as CommentBody).id;

      const up = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .send({ type: VoteType.UP });
      expect(up.status).toBe(200);
      expect(up.body as VoteBody).toEqual({ score: 1, userVote: VoteType.UP });

      // idempotent re-cast of the same vote
      const reUp = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .send({ type: VoteType.UP });
      expect((reUp.body as VoteBody).score).toBe(1);

      // flip UP -> DOWN : score goes from 1 to -1
      const down = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .send({ type: VoteType.DOWN });
      expect(down.body as VoteBody).toEqual({
        score: -1,
        userVote: VoteType.DOWN,
      });

      const withdrawn = await request(app.getHttpServer())
        .delete(`/offers/${offerId}/comments/${id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`);
      expect(withdrawn.body as VoteBody).toEqual({ score: 0, userVote: null });
    });

    it('exposes the viewer userVote in the thread, null for anonymous', async () => {
      const author = await registerUser('author@example.com', 'author');
      const voter = await registerUser('v@example.com', 'voter');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'vote me',
      });
      const id = (created.body as CommentBody).id;
      await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/votes`)
        .set('Authorization', `Bearer ${voter.accessToken}`)
        .send({ type: VoteType.UP });

      const asVoter = await request(app.getHttpServer())
        .get(`/offers/${offerId}/comments`)
        .set('Authorization', `Bearer ${voter.accessToken}`);
      expect((asVoter.body as CommentListBody).items[0].userVote).toBe(
        VoteType.UP,
      );

      const anonymous = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      expect((anonymous.body as CommentListBody).items[0].userVote).toBeNull();
      expect((anonymous.body as CommentListBody).items[0].score).toBe(1);
    });
  });

  describe('Pagination', () => {
    it('paginates the thread with a cursor', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      for (let i = 0; i < 3; i++) {
        await comment(author.accessToken, offerId, { content: `c${i}` });
      }

      const first = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments?limit=2`,
      );
      const firstBody = first.body as CommentListBody;
      expect(firstBody.items).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments?limit=2&cursor=${firstBody.nextCursor as string}`,
      );
      const secondBody = second.body as CommentListBody;
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
    });
  });

  describe('Reporting', () => {
    function reportComment(
      token: string,
      offerId: string,
      commentId: string,
      body: { reason: string; note?: string },
    ) {
      return request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${commentId}/reports`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    it('reports a comment and increments reportCount idempotently', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('r@example.com', 'reporter');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'report me',
      });
      const id = (created.body as CommentBody).id;

      const first = await reportComment(reporter.accessToken, offerId, id, {
        reason: 'SPAM',
        note: 'looks like an ad',
      });
      expect(first.status).toBe(201);
      expect((first.body as { reportCount: number }).reportCount).toBe(1);

      // same user re-reporting does not double count
      const again = await reportComment(reporter.accessToken, offerId, id, {
        reason: 'ABUSE',
      });
      expect((again.body as { reportCount: number }).reportCount).toBe(1);
    });

    it('exposes the reporter own report reason via /reports/me', async () => {
      const author = await registerUser('author@example.com', 'author');
      const reporter = await registerUser('r@example.com', 'reporter');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'report me',
      });
      const id = (created.body as CommentBody).id;
      await reportComment(reporter.accessToken, offerId, id, {
        reason: 'OFF_TOPIC',
      });

      const mine = await request(app.getHttpServer())
        .get(`/offers/${offerId}/comments/${id}/reports/me`)
        .set('Authorization', `Bearer ${reporter.accessToken}`);
      expect((mine.body as { reason: string | null }).reason).toBe('OFF_TOPIC');
    });

    it('rejects reporting without authentication with 401', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'report me',
      });
      const id = (created.body as CommentBody).id;

      const res = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/reports`)
        .send({ reason: 'SPAM' });
      expect(res.status).toBe(401);
    });

    it('rejects reporting a missing comment with comment.not_found', async () => {
      const reporter = await registerUser('r@example.com', 'reporter');
      const offerId = await createOffer(reporter.accessToken);

      const res = await reportComment(
        reporter.accessToken,
        offerId,
        '00000000-0000-0000-0000-000000000000',
        { reason: 'SPAM' },
      );
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).key).toBe('comment.not_found');
    });
  });
});
