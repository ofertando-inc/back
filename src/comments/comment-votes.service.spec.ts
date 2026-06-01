import { Test, TestingModule } from '@nestjs/testing';
import { Comment, CommentVote, VoteType } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { CommentVotesService } from './comment-votes.service';

function buildComment(overrides: Partial<Comment> = {}): Comment {
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
    userId: 'author-1',
    offerId: 'offer-1',
    parentId: null,
    replyToId: null,
    ...overrides,
  };
}

function buildVote(overrides: Partial<CommentVote> = {}): CommentVote {
  return {
    id: 'vote-1',
    type: VoteType.UP,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'user-1',
    commentId: 'comment-1',
    ...overrides,
  };
}

type PrismaCommentMock = {
  findUnique: jest.Mock;
  update: jest.Mock;
};

type PrismaCommentVoteMock = {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

describe('CommentVotesService', () => {
  let service: CommentVotesService;
  let comment: PrismaCommentMock;
  let commentVote: PrismaCommentVoteMock;
  let prisma: {
    comment: PrismaCommentMock;
    commentVote: PrismaCommentVoteMock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    comment = { findUnique: jest.fn(), update: jest.fn() };
    commentVote = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    prisma = {
      comment,
      commentVote,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentVotesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommentVotesService);
  });

  describe('cast', () => {
    it('creates an UP vote and increments the score by 1', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ score: 6 }));

      const result = await service.cast('user-1', 'comment-1', VoteType.UP);

      expect(commentVote.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', commentId: 'comment-1', type: VoteType.UP },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { increment: 1 } },
      });
      expect(result).toEqual({ score: 6, userVote: VoteType.UP });
    });

    it('creates a DOWN vote and decrements the score by 1', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ score: 4 }));

      const result = await service.cast('user-1', 'comment-1', VoteType.DOWN);

      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { increment: -1 } },
      });
      expect(result).toEqual({ score: 4, userVote: VoteType.DOWN });
    });

    it('is a no-op when the user re-casts the same vote', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(
        buildVote({ type: VoteType.UP }),
      );

      const result = await service.cast('user-1', 'comment-1', VoteType.UP);

      expect(commentVote.create).not.toHaveBeenCalled();
      expect(commentVote.update).not.toHaveBeenCalled();
      expect(comment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ score: 5, userVote: VoteType.UP });
    });

    it('switches UP to DOWN with a -2 score delta', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(
        buildVote({ type: VoteType.UP }),
      );
      comment.update.mockResolvedValue(buildComment({ score: 3 }));

      const result = await service.cast('user-1', 'comment-1', VoteType.DOWN);

      expect(commentVote.update).toHaveBeenCalledWith({
        where: { id: 'vote-1' },
        data: { type: VoteType.DOWN },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { increment: -2 } },
      });
      expect(result).toEqual({ score: 3, userVote: VoteType.DOWN });
    });

    it('switches DOWN to UP with a +2 score delta', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(
        buildVote({ type: VoteType.DOWN }),
      );
      comment.update.mockResolvedValue(buildComment({ score: 7 }));

      const result = await service.cast('user-1', 'comment-1', VoteType.UP);

      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { increment: 2 } },
      });
      expect(result).toEqual({ score: 7, userVote: VoteType.UP });
    });

    it('throws comment.not_found when the comment does not exist', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(
        service.cast('user-1', 'missing', VoteType.UP),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('throws comment.not_found when the comment is deleted', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ deletedAt: new Date() }),
      );

      await expect(
        service.cast('user-1', 'comment-1', VoteType.UP),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('runs inside a Prisma transaction', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ score: 6 }));

      await service.cast('user-1', 'comment-1', VoteType.UP);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('withdraw', () => {
    it('removes an existing UP vote and decrements the score by 1', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(
        buildVote({ type: VoteType.UP }),
      );
      comment.update.mockResolvedValue(buildComment({ score: 4 }));

      const result = await service.withdraw('user-1', 'comment-1');

      expect(commentVote.delete).toHaveBeenCalledWith({
        where: { id: 'vote-1' },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { decrement: 1 } },
      });
      expect(result).toEqual({ score: 4, userVote: null });
    });

    it('removes an existing DOWN vote and increments the score by 1', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(
        buildVote({ type: VoteType.DOWN }),
      );
      comment.update.mockResolvedValue(buildComment({ score: 6 }));

      const result = await service.withdraw('user-1', 'comment-1');

      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { score: { decrement: -1 } },
      });
      expect(result).toEqual({ score: 6, userVote: null });
    });

    it('is idempotent when no vote exists', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ score: 5 }));
      commentVote.findUnique.mockResolvedValue(null);

      const result = await service.withdraw('user-1', 'comment-1');

      expect(commentVote.delete).not.toHaveBeenCalled();
      expect(comment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ score: 5, userVote: null });
    });

    it('throws comment.not_found when the comment is missing or deleted', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(service.withdraw('user-1', 'missing')).rejects.toMatchObject(
        { key: ErrorKey.CommentNotFound },
      );
    });
  });
});
