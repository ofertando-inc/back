import { Test, TestingModule } from '@nestjs/testing';
import { Comment, CommentLike } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { CommentLikesService } from './comment-likes.service';

function buildComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    content: 'Nice deal',
    createdAt: new Date('2024-06-01T00:00:00Z'),
    updatedAt: new Date('2024-06-01T00:00:00Z'),
    editedAt: null,
    deletedAt: null,
    likeCount: 0,
    replyCount: 0,
    userId: 'author-1',
    offerId: 'offer-1',
    parentId: null,
    ...overrides,
  };
}

function buildLike(overrides: Partial<CommentLike> = {}): CommentLike {
  return {
    id: 'like-1',
    createdAt: new Date(),
    userId: 'user-1',
    commentId: 'comment-1',
    ...overrides,
  };
}

describe('CommentLikesService', () => {
  let service: CommentLikesService;
  let comment: { findUnique: jest.Mock; update: jest.Mock };
  let commentLike: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let prisma: {
    comment: typeof comment;
    commentLike: typeof commentLike;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    comment = { findUnique: jest.fn(), update: jest.fn() };
    commentLike = {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };
    prisma = {
      comment,
      commentLike,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentLikesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommentLikesService);
  });

  describe('like', () => {
    it('creates a like and increments likeCount', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ likeCount: 4 }));
      commentLike.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ likeCount: 5 }));

      const result = await service.like('user-1', 'comment-1');

      expect(commentLike.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', commentId: 'comment-1' },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { likeCount: { increment: 1 } },
      });
      expect(result).toEqual({ likeCount: 5, liked: true });
    });

    it('is idempotent when the user already liked the comment', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ likeCount: 4 }));
      commentLike.findUnique.mockResolvedValue(buildLike());

      const result = await service.like('user-1', 'comment-1');

      expect(commentLike.create).not.toHaveBeenCalled();
      expect(comment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ likeCount: 4, liked: true });
    });

    it('throws comment.not_found when the comment is missing or deleted', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ deletedAt: new Date() }),
      );

      await expect(service.like('user-1', 'comment-1')).rejects.toMatchObject({
        key: ErrorKey.CommentNotFound,
      });
    });
  });

  describe('unlike', () => {
    it('removes the like and decrements likeCount', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ likeCount: 5 }));
      commentLike.findUnique.mockResolvedValue(buildLike());
      comment.update.mockResolvedValue(buildComment({ likeCount: 4 }));

      const result = await service.unlike('user-1', 'comment-1');

      expect(commentLike.delete).toHaveBeenCalledWith({
        where: { id: 'like-1' },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { likeCount: { decrement: 1 } },
      });
      expect(result).toEqual({ likeCount: 4, liked: false });
    });

    it('is idempotent when no like exists', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ likeCount: 4 }));
      commentLike.findUnique.mockResolvedValue(null);

      const result = await service.unlike('user-1', 'comment-1');

      expect(commentLike.delete).not.toHaveBeenCalled();
      expect(comment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ likeCount: 4, liked: false });
    });

    it('throws comment.not_found when the comment is missing or deleted', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(service.unlike('user-1', 'comment-1')).rejects.toMatchObject(
        { key: ErrorKey.CommentNotFound },
      );
    });
  });
});
