import { Test, TestingModule } from '@nestjs/testing';
import {
  Comment,
  CommentReport,
  CommentReportReason,
  ReportStatus,
} from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { CommentReportsService } from './comment-reports.service';

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

function buildReport(overrides: Partial<CommentReport> = {}): CommentReport {
  return {
    id: 'report-1',
    reason: CommentReportReason.SPAM,
    note: null,
    status: ReportStatus.PENDING,
    createdAt: new Date(),
    resolvedAt: null,
    userId: 'user-1',
    commentId: 'comment-1',
    ...overrides,
  };
}

type PrismaCommentMock = {
  findUnique: jest.Mock;
  update: jest.Mock;
};

type PrismaCommentReportMock = {
  findUnique: jest.Mock;
  create: jest.Mock;
};

describe('CommentReportsService', () => {
  let service: CommentReportsService;
  let comment: PrismaCommentMock;
  let commentReport: PrismaCommentReportMock;
  let prisma: {
    comment: PrismaCommentMock;
    commentReport: PrismaCommentReportMock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    comment = { findUnique: jest.fn(), update: jest.fn() };
    commentReport = { findUnique: jest.fn(), create: jest.fn() };
    prisma = {
      comment,
      commentReport,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentReportsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CommentReportsService);
  });

  describe('create', () => {
    it('creates a report and increments the comment reportCount', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ reportCount: 2 }));
      commentReport.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ reportCount: 3 }));

      const result = await service.create('user-1', 'offer-1', 'comment-1', {
        reason: CommentReportReason.SPAM,
        note: 'spammy link',
      });

      expect(commentReport.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          commentId: 'comment-1',
          reason: CommentReportReason.SPAM,
          note: 'spammy link',
        },
      });
      expect(comment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { reportCount: { increment: 1 } },
      });
      expect(result).toEqual({ reportCount: 3 });
    });

    it('is idempotent when the user already reported the comment', async () => {
      comment.findUnique.mockResolvedValue(buildComment({ reportCount: 4 }));
      commentReport.findUnique.mockResolvedValue(buildReport());

      const result = await service.create('user-1', 'offer-1', 'comment-1', {
        reason: CommentReportReason.ABUSE,
      });

      expect(commentReport.create).not.toHaveBeenCalled();
      expect(comment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ reportCount: 4 });
    });

    it('throws comment.not_found when the comment does not exist', async () => {
      comment.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', 'offer-1', 'missing', {
          reason: CommentReportReason.SPAM,
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('throws comment.not_found when the comment is deleted', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ deletedAt: new Date() }),
      );

      await expect(
        service.create('user-1', 'offer-1', 'comment-1', {
          reason: CommentReportReason.SPAM,
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('throws comment.not_found when the comment belongs to another offer', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ offerId: 'other-offer' }),
      );

      await expect(
        service.create('user-1', 'offer-1', 'comment-1', {
          reason: CommentReportReason.SPAM,
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotFound });
    });

    it('throws comment.not_reportable when the comment is hidden by a moderator', async () => {
      comment.findUnique.mockResolvedValue(
        buildComment({ hiddenAt: new Date() }),
      );

      await expect(
        service.create('user-1', 'offer-1', 'comment-1', {
          reason: CommentReportReason.SPAM,
        }),
      ).rejects.toMatchObject({ key: ErrorKey.CommentNotReportable });
    });

    it('runs inside a Prisma transaction', async () => {
      comment.findUnique.mockResolvedValue(buildComment());
      commentReport.findUnique.mockResolvedValue(null);
      comment.update.mockResolvedValue(buildComment({ reportCount: 1 }));

      await service.create('user-1', 'offer-1', 'comment-1', {
        reason: CommentReportReason.OTHER,
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('findUserReport', () => {
    it('returns the report when one exists', async () => {
      const existing = buildReport();
      commentReport.findUnique.mockResolvedValue(existing);

      await expect(service.findUserReport('user-1', 'comment-1')).resolves.toBe(
        existing,
      );
      expect(commentReport.findUnique).toHaveBeenCalledWith({
        where: {
          userId_commentId: { userId: 'user-1', commentId: 'comment-1' },
        },
      });
    });

    it('returns null when no report exists', async () => {
      commentReport.findUnique.mockResolvedValue(null);

      await expect(
        service.findUserReport('user-1', 'comment-1'),
      ).resolves.toBeNull();
    });
  });
});
