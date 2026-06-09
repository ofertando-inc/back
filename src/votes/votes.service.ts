import { HttpStatus, Injectable } from '@nestjs/common';
import { OfferStatus, Prisma, Vote, VoteType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import type { CursorPaginationQueryDto } from '../common/pagination/cursor-pagination-query.dto';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.helper';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import type { MyVote } from './types/my-vote.type';
import { VoteResponse } from './types/vote-response.type';

type VoteCursor = {
  createdAt: string;
  id: string;
};

function voteWeight(type: VoteType): number {
  return type === VoteType.UP ? 1 : -1;
}

@Injectable()
export class VotesService {
  constructor(private readonly prisma: PrismaService) {}

  async cast(
    userId: string,
    offerId: string,
    type: VoteType,
  ): Promise<VoteResponse> {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });

      if (!offer || offer.status === OfferStatus.DELETED) {
        throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
      }

      if (
        offer.status !== OfferStatus.ACTIVE ||
        offer.endDate.getTime() < Date.now()
      ) {
        throw new AppException(
          ErrorKey.VoteOfferNotVoteable,
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await tx.vote.findUnique({
        where: { userId_offerId: { userId, offerId } },
      });

      if (existing && existing.type === type) {
        return { score: offer.score, userVote: type };
      }

      let scoreDelta: number;
      if (!existing) {
        await tx.vote.create({ data: { userId, offerId, type } });
        scoreDelta = voteWeight(type);
      } else {
        await tx.vote.update({
          where: { id: existing.id },
          data: { type },
        });
        scoreDelta = voteWeight(type) - voteWeight(existing.type);
      }

      const updated = await tx.offer.update({
        where: { id: offerId },
        data: { score: { increment: scoreDelta } },
      });

      return { score: updated.score, userVote: type };
    });
  }

  async withdraw(userId: string, offerId: string): Promise<VoteResponse> {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });

      if (!offer || offer.status === OfferStatus.DELETED) {
        throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
      }

      if (
        offer.status !== OfferStatus.ACTIVE ||
        offer.endDate.getTime() < Date.now()
      ) {
        throw new AppException(
          ErrorKey.VoteOfferNotVoteable,
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await tx.vote.findUnique({
        where: { userId_offerId: { userId, offerId } },
      });

      if (!existing) {
        return { score: offer.score, userVote: null };
      }

      await tx.vote.delete({ where: { id: existing.id } });

      const updated = await tx.offer.update({
        where: { id: offerId },
        data: { score: { decrement: voteWeight(existing.type) } },
      });

      return { score: updated.score, userVote: null };
    });
  }

  findUserVote(userId: string, offerId: string): Promise<Vote | null> {
    return this.prisma.vote.findUnique({
      where: { userId_offerId: { userId, offerId } },
    });
  }

  // Offers a given user has voted on, most recent vote first. Votes on deleted
  // offers are skipped since their target is no longer visible.
  async findByUser(
    userId: string,
    query: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<MyVote>> {
    const limit = query.limit ?? 20;
    const where: Prisma.VoteWhereInput = {
      userId,
      offer: { status: { not: OfferStatus.DELETED } },
    };

    if (query.cursor) {
      const cursor = decodeCursor<VoteCursor>(query.cursor);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const items = await this.prisma.vote.findMany({
      where,
      include: { offer: { select: { id: true, title: true, score: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];

    return {
      items: trimmed.map((vote) => ({
        type: vote.type,
        createdAt: vote.createdAt,
        offer: vote.offer,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor<VoteCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }
}
