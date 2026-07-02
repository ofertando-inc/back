import { HttpStatus, Injectable } from '@nestjs/common';
import { CommentReport, ReportStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportCommentDto } from './dto/report-comment.dto';
import { CommentReportResponse } from './types/comment-report-response.type';

@Injectable()
export class CommentReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    offerId: string,
    commentId: string,
    dto: ReportCommentDto,
  ): Promise<CommentReportResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.findUnique({ where: { id: commentId } });

      if (!comment || comment.deletedAt || comment.offerId !== offerId) {
        throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
      }

      // A comment already removed by a moderator is no longer reportable.
      if (comment.hiddenAt) {
        throw new AppException(
          ErrorKey.CommentNotReportable,
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await tx.commentReport.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });

      // A still-open report from this user is a no-op (one report per cycle).
      if (existing && existing.status === ReportStatus.PENDING) {
        return { reportCount: comment.reportCount };
      }

      if (existing) {
        // The user's previous report was resolved/dismissed: re-open it so the
        // comment can climb back into the moderation queue.
        await tx.commentReport.update({
          where: { id: existing.id },
          data: {
            status: ReportStatus.PENDING,
            resolvedAt: null,
            reason: dto.reason,
            note: dto.note ?? null,
          },
        });
      } else {
        await tx.commentReport.create({
          data: {
            userId,
            commentId,
            reason: dto.reason,
            note: dto.note ?? null,
          },
        });
      }

      const incremented = await tx.comment.update({
        where: { id: commentId },
        data: { reportCount: { increment: 1 } },
      });

      return { reportCount: incremented.reportCount };
    });
  }

  findUserReport(
    userId: string,
    commentId: string,
  ): Promise<CommentReport | null> {
    return this.prisma.commentReport.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });
  }
}
