import { HttpStatus, Injectable } from '@nestjs/common';
import { OfferStatus, Vote, VoteType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { VoteResponse } from './types/vote-response.type';

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

      if (offer.status !== OfferStatus.ACTIVE) {
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

      if (offer.status !== OfferStatus.ACTIVE) {
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
}
