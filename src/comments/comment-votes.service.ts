import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, VoteType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { ReputationService } from '../reputation/reputation.service';
import { CommentVoteResponse } from './types/comment-vote-response.type';

function voteWeight(type: VoteType): number {
  return type === VoteType.UP ? 1 : -1;
}

function isUp(type: VoteType | null): number {
  return type === VoteType.UP ? 1 : 0;
}

@Injectable()
export class CommentVotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reputation: ReputationService,
  ) {}

  async cast(
    userId: string,
    commentId: string,
    type: VoteType,
  ): Promise<CommentVoteResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await this.requireComment(tx, commentId);

      const existing = await tx.commentVote.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });

      if (existing && existing.type === type) {
        return { score: comment.score, userVote: type };
      }

      let scoreDelta: number;
      if (!existing) {
        await tx.commentVote.create({ data: { userId, commentId, type } });
        scoreDelta = voteWeight(type);
      } else {
        await tx.commentVote.update({
          where: { id: existing.id },
          data: { type },
        });
        scoreDelta = voteWeight(type) - voteWeight(existing.type);
      }

      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { score: { increment: scoreDelta } },
      });

      // Reward the comment's author for the net change in this user's upvote
      // (not for self-votes).
      const repDelta =
        this.reputation.points('commentUpvote') *
        (isUp(type) - isUp(existing?.type ?? null));
      if (repDelta !== 0 && comment.userId !== userId) {
        await this.reputation.applyWithin(tx, comment.userId, repDelta, {
          reason: 'commentUpvote',
          sourceType: 'comment_vote',
          sourceId: commentId,
        });
      }

      return { score: updated.score, userVote: type };
    });
  }

  async withdraw(
    userId: string,
    commentId: string,
  ): Promise<CommentVoteResponse> {
    return this.prisma.$transaction(async (tx) => {
      const comment = await this.requireComment(tx, commentId);

      const existing = await tx.commentVote.findUnique({
        where: { userId_commentId: { userId, commentId } },
      });

      if (!existing) {
        return { score: comment.score, userVote: null };
      }

      await tx.commentVote.delete({ where: { id: existing.id } });

      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { score: { decrement: voteWeight(existing.type) } },
      });

      // Removing an upvote takes back the author's reward (not for self-votes).
      if (existing.type === VoteType.UP && comment.userId !== userId) {
        await this.reputation.applyWithin(
          tx,
          comment.userId,
          -this.reputation.points('commentUpvote'),
          {
            reason: 'commentUpvote',
            sourceType: 'comment_vote',
            sourceId: commentId,
          },
        );
      }

      return { score: updated.score, userVote: null };
    });
  }

  private async requireComment(
    tx: Prisma.TransactionClient,
    commentId: string,
  ) {
    const comment = await tx.comment.findUnique({ where: { id: commentId } });

    if (!comment || comment.deletedAt) {
      throw new AppException(ErrorKey.CommentNotFound, HttpStatus.NOT_FOUND);
    }

    return comment;
  }
}
