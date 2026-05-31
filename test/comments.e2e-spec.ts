import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, UserRole } from '@prisma/client';
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
  content: string;
  editedAt: string | null;
  user: { id: string; username: string };
  likeCount: number;
  replyCount: number;
  liked: boolean;
};

type CommentListBody = {
  items: CommentBody[];
  nextCursor: string | null;
};

type LikeBody = { likeCount: number; liked: boolean };

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
        likeCount: 0,
        replyCount: 0,
        liked: false,
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

  describe('Threading (one level)', () => {
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

    it('rejects replying to a reply with comment.cannot_reply_to_reply', async () => {
      const author = await registerUser('author@example.com', 'author');
      const offerId = await createOffer(author.accessToken);
      const root = await comment(author.accessToken, offerId, {
        content: 'root',
      });
      const reply = await comment(author.accessToken, offerId, {
        content: 'reply',
        parentId: (root.body as CommentBody).id,
      });

      const res = await comment(author.accessToken, offerId, {
        content: 'reply to reply',
        parentId: (reply.body as CommentBody).id,
      });
      const body = res.body as ErrorBody;

      expect(res.status).toBe(400);
      expect(body.key).toBe('comment.cannot_reply_to_reply');
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

    it('lets an admin delete any comment and cascades to replies', async () => {
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

      expect(del.status).toBe(204);

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

  describe('Likes', () => {
    it('likes and unlikes a comment, reflecting likeCount and liked', async () => {
      const author = await registerUser('author@example.com', 'author');
      const liker = await registerUser('l@example.com', 'liker');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'like me',
      });
      const id = (created.body as CommentBody).id;

      const liked = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/likes`)
        .set('Authorization', `Bearer ${liker.accessToken}`);
      expect(liked.status).toBe(200);
      expect(liked.body as LikeBody).toEqual({ likeCount: 1, liked: true });

      // idempotent re-like
      const reliked = await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/likes`)
        .set('Authorization', `Bearer ${liker.accessToken}`);
      expect((reliked.body as LikeBody).likeCount).toBe(1);

      const unliked = await request(app.getHttpServer())
        .delete(`/offers/${offerId}/comments/${id}/likes`)
        .set('Authorization', `Bearer ${liker.accessToken}`);
      expect(unliked.body as LikeBody).toEqual({ likeCount: 0, liked: false });
    });

    it('exposes liked=true in the thread for the viewer who liked', async () => {
      const author = await registerUser('author@example.com', 'author');
      const liker = await registerUser('l@example.com', 'liker');
      const offerId = await createOffer(author.accessToken);
      const created = await comment(author.accessToken, offerId, {
        content: 'like me',
      });
      const id = (created.body as CommentBody).id;
      await request(app.getHttpServer())
        .post(`/offers/${offerId}/comments/${id}/likes`)
        .set('Authorization', `Bearer ${liker.accessToken}`);

      const asLiker = await request(app.getHttpServer())
        .get(`/offers/${offerId}/comments`)
        .set('Authorization', `Bearer ${liker.accessToken}`);
      expect((asLiker.body as CommentListBody).items[0].liked).toBe(true);

      const anonymous = await request(app.getHttpServer()).get(
        `/offers/${offerId}/comments`,
      );
      expect((anonymous.body as CommentListBody).items[0].liked).toBe(false);
      expect((anonymous.body as CommentListBody).items[0].likeCount).toBe(1);
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
});
