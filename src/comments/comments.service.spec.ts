import { Test, TestingModule } from '@nestjs/testing';
import { Comment, Offer, OfferStatus, VoteType } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { encodeCursor } from '../common/pagination/cursor.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CommentsService } from './comments.service';

const objectContaining = <T extends object>(value: T): T =>
  expect.objectContaining(value) as unknown as T;

function buildOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    title: 'Title',
    description: 'Description',
    offerType: 'discount',
    externalUrl: null,
    storeName: 'Store',
    city: 'Bogotá',
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2099-01-01T00:00:00Z'),
    status: OfferStatus.ACTIVE,
    score: 0,
    reportCount: 0,
    commentCount: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    disabledAt: null,
    deletedAt: null,
    createdById: 'author-1',
    storeId: null,
    ...overrides,
  };
}

type CommentRow = Comment & {
  user?: { id: string; username: string };
  replyTo?: { id: string; user: { username: string } } | null;
  votes?: { type: VoteType }[];
};

function buildComment(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'comment-1',
    content: 'Nice deal',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
    score: 0,
    replyCount: 0,
    reportCount: 0,
    userId: 'user-1',
    offerId: 'offer-1',
    parentId: null,
    replyToId: null,
    user: { id: 'user-1', username: 'commenter' },
    replyTo: null,
    ...overrides,
  };
}

describe('CommentsService', () => {
  let service: CommentsService;
  let offer: { findUnique: jest.Mock; update: jest.Mock };
  let comment: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  let prisma: {
    offer: typeof offer;
    comment: typeof comment;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    offer = { findUnique: jest.fn(), update: jest.fn() };
    comment = {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    prisma = {
      offer,
      comment,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommentsService);
  });

  describe('create', () => {
    it('creates a top-level comment and increments the offer commentCount', async () => {
      offer.findUnique.mockResolvedValue(buildOffer());
      comment.create.mockResolvedValue(buildComment());

      const result = await service.create('user-1', 'offer-1', {
        content: 'Nice deal',
      });

      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { increment: 1 } },
      });
      expect(result).toMatchObject({
        id: 'comment-1',
        content: 'Nice deal',
        user: { id: 'user-1', username: 'commenter' },
        score: 0,
        replyCount: 0,
        userVote: null,
      });
    });

    it('creates a reply to a root comment and increments both commentCount and the parent replyCount', async () => {
      offer.findUnique.mockResolvedValue(buildOffer());
      comment.findUnique.mockResolvedValue(
        buildComment({ id: 'parent-1', parentId: null }),
      );
      comment.create.mockResolvedValue(
        buildComment({ id: 'reply-1', parentId: 'parent-1' }),
      );

      await service.create('user-1', 'offer-1', {
        content: 'I confirm it works',
        parentId: 'parent-1',
      });

      expect(comment.create).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({ parentId: 'parent-1', replyToId: null }),
        }),
      );
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'parent-1' },
        data: { replyCount: { increment: 1 } },
      });
      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { increment: 1 } },
      });
    });

    it('flattens a reply-to-a-reply under the thread root and records replyToId', async () => {
      offer.findUnique.mockResolvedValue(buildOffer());
      comment.findUnique.mockResolvedValue(
        buildComment({ id: 'reply-1', parentId: 'root-1' }),
      );
      comment.create.mockResolvedValue(
        buildComment({
          id: 'reply-2',
          parentId: 'root-1',
          replyToId: 'reply-1',
          replyTo: { id: 'reply-1', user: { username: 'commenter' } },
        }),
      );

      const result = await service.create('user-1', 'offer-1', {
        content: 'agreed with you',
        parentId: 'reply-1',
      });

      // parentId is normalized to the root, replyToId tags the answered reply
      expect(comment.create).toHaveBeenCalledWith(
        objectContaining({
          data: objectContaining({
            parentId: 'root-1',
            replyToId: 'reply-1',
          }),
        }),
      );
      // the root (not the answered reply) gets its replyCount incremented
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'root-1' },
        data: { replyCount: { increment: 1 } },
      });
      expect(result.replyTo).toEqual({ id: 'reply-1', username: 'commenter' });
    });

    it('throws offer.not_found when the offer does not exist', async () => {
      offer.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'missing', { content: 'x' }),
      ).rejects.toMatchObject({ key: ErrorKey.OfferNotFound });
    });

    it.each([OfferStatus.DISABLED, OfferStatus.REPORTED])(
      'throws comment.offer_not_commentable when the offer is %s',
      async (status) => {
        offer.findUnique.mockResolvedValue(buildOffer({ status }));

        await expect(
          service.create('user-1', 'offer-1', { content: 'x' }),
        ).rejects.toMatchObject({ key: ErrorKey.CommentOfferNotCommentable });
      },
    );

    it('allows commenting on an EXPIRED offer', async () => {
      offer.findUnique.mockResolvedValue(
        buildOffer({ status: OfferStatus.EXPIRED }),
      );
      comment.create.mockResolvedValue(buildComment());

      await expect(
        service.create('user-1', 'offer-1', { content: 'still relevant?' }),
      ).resolves.toBeDefined();
    });

    it('throws comment.not_found when replying to a missing parent', async () => {
      offer.findUnique.mockResolvedValue(buildOffer());
      comment.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'offer-1', {
          content: 'x',
          parentId: 'ghost',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('throws comment.not_found when replying to a deleted parent', async () => {
      offer.findUnique.mockResolvedValue(buildOffer());
      comment.findUnique.mockResolvedValue(
        buildComment({ id: 'parent-1', deletedAt: new Date() }),
      );

      await expect(
        service.create('user-1', 'offer-1', {
          content: 'x',
          parentId: 'parent-1',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });
  });

  describe('update', () => {
    it('throws comment.not_found when the comment is missing or deleted', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { content: 'x' }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('updates the content and stamps editedAt', async () => {
      comment.findUnique.mockResolvedValue(buildComment());
      comment.update.mockResolvedValue(
        buildComment({ content: 'edited', editedAt: new Date() }),
      );

      const result = await service.update('comment-1', { content: 'edited' });

      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { content: 'edited', editedAt: expect.any(Date) as Date },
        include: expect.any(Object) as object,
      });
      expect(result.content).toBe('edited');
    });
  });

  describe('softDelete', () => {
    it('tombstones a top-level comment without cascading to replies', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ id: 'root-1', parentId: null, offerId: 'offer-1' }),
      );
      comment.update.mockResolvedValue(
        buildComment({ id: 'root-1', deletedAt: new Date() }),
      );

      const result = await service.softDelete('root-1');

      // No cascade: replies are never bulk-deleted.
      expect(comment.updateMany).not.toHaveBeenCalled();
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'root-1' },
        data: { deletedAt: expect.any(Date) as Date },
        include: expect.any(Object) as object,
      });
      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { decrement: 1 } },
      });
      expect(result.deleted).toBe(true);
      expect(result.content).toBeNull();
    });

    it('tombstones a reply and decrements both commentCount and parent replyCount', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ id: 'reply-1', parentId: 'root-1' }),
      );
      comment.update.mockResolvedValue(
        buildComment({
          id: 'reply-1',
          parentId: 'root-1',
          deletedAt: new Date(),
        }),
      );

      await service.softDelete('reply-1');

      expect(offer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { commentCount: { decrement: 1 } },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'root-1' },
        data: { replyCount: { decrement: 1 } },
      });
    });

    it('throws comment.not_found when the comment is missing or already deleted', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('missing')).rejects.toMatchObject({
        key: ErrorKey.CommentNotFound,
      });
    });
  });

  describe('findThread', () => {
    it('lists top-level comments and exposes the viewer vote', async () => {
      comment.findMany.mockResolvedValue([
        buildComment({ id: 'c1', votes: [{ type: VoteType.UP }] }),
      ]);

      const result = await service.findThread('offer-1', {}, 'viewer-1');

      const calls = comment.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: { offerId: string; parentId: null; OR: unknown[] };
      };
      expect(call.where).toMatchObject({ offerId: 'offer-1', parentId: null });
      // Live comments OR tombstones (removed by author or moderator, with a
      // surviving live reply).
      expect(call.where.OR).toEqual([
        { deletedAt: null, hiddenAt: null },
        {
          OR: [{ deletedAt: { not: null } }, { hiddenAt: { not: null } }],
          replies: { some: { deletedAt: null, hiddenAt: null } },
        },
      ]);
      expect(result.items[0].userVote).toBe(VoteType.UP);
      expect(result.nextCursor).toBeNull();
    });

    it('exposes a tombstone with masked content and deleted=true', async () => {
      comment.findMany.mockResolvedValue([
        buildComment({ id: 'c1', deletedAt: new Date(), replyCount: 2 }),
      ]);

      const result = await service.findThread('offer-1', {});

      expect(result.items[0]).toMatchObject({
        id: 'c1',
        content: null,
        deleted: true,
        hidden: false,
        replyCount: 2,
      });
    });

    it('masks a moderator-hidden comment with hidden=true', async () => {
      comment.findMany.mockResolvedValue([
        buildComment({ id: 'c1', hiddenAt: new Date(), replyCount: 1 }),
      ]);

      const result = await service.findThread('offer-1', {});

      expect(result.items[0]).toMatchObject({
        id: 'c1',
        content: null,
        deleted: false,
        hidden: true,
      });
    });

    it('returns a nextCursor when there are more items', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        buildComment({ id: `c${i}`, createdAt: new Date(2024, 0, i + 1) }),
      );
      comment.findMany.mockResolvedValue(rows);

      const result = await service.findThread('offer-1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('findReplies', () => {
    it('scopes the query to the parent comment', async () => {
      comment.findMany.mockResolvedValue([]);
      const cursor = encodeCursor({
        createdAt: '2024-06-01T00:00:00Z',
        id: 'c-9',
      });

      await service.findReplies('offer-1', 'parent-1', { cursor });

      const calls = comment.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: { parentId: string; AND: { OR: unknown[] }[] };
      };
      expect(call.where.parentId).toBe('parent-1');
      expect(call.where.AND[0].OR).toHaveLength(2);
    });
  });

  describe('findByUser', () => {
    it('scopes to the author, excludes deleted ones, and maps the offer context', async () => {
      comment.findMany.mockResolvedValue([
        {
          ...buildComment({
            id: 'comment-1',
            content: 'My take',
            createdAt: new Date('2024-06-02T00:00:00Z'),
            score: 4,
            replyCount: 2,
            hiddenAt: new Date('2024-06-03T00:00:00Z'),
          }),
          offer: { id: 'offer-1', title: 'A deal' },
        },
      ]);

      const result = await service.findByUser('user-1', {});

      const calls = comment.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: { userId: string; deletedAt: null };
        include: unknown;
        orderBy: unknown;
        take: number;
      };
      expect(call.where).toEqual({ userId: 'user-1', deletedAt: null });
      expect(call.include).toEqual({
        offer: { select: { id: true, title: true } },
      });
      expect(call.take).toBe(21);
      expect(result.items).toEqual([
        {
          id: 'comment-1',
          content: 'My take',
          createdAt: new Date('2024-06-02T00:00:00Z'),
          editedAt: null,
          score: 4,
          replyCount: 2,
          hidden: true,
          offer: { id: 'offer-1', title: 'A deal' },
        },
      ]);
      expect(result.nextCursor).toBeNull();
    });

    it('applies the cursor predicate and returns a next cursor when truncated', async () => {
      comment.findMany.mockResolvedValue([
        {
          ...buildComment({
            id: 'c-1',
            createdAt: new Date('2024-06-02T00:00:00Z'),
          }),
          offer: { id: 'offer-1', title: 'A' },
        },
        {
          ...buildComment({
            id: 'c-2',
            createdAt: new Date('2024-06-01T00:00:00Z'),
          }),
          offer: { id: 'offer-2', title: 'B' },
        },
      ]);
      const cursor = encodeCursor({
        createdAt: '2024-06-05T00:00:00Z',
        id: 'c-0',
      });

      const result = await service.findByUser('user-1', { cursor, limit: 1 });

      const calls = comment.findMany.mock.calls as unknown[][];
      const call = calls[0]?.[0] as {
        where: { AND: { OR: unknown[] }[] };
        take: number;
      };
      expect(call.where.AND[0].OR).toHaveLength(2);
      expect(call.take).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    });
  });
});
