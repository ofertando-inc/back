import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

// Barème keys (also stored as the ledger `reason`).
export type ReputationReason =
  | 'offerUpvote'
  | 'commentUpvote'
  | 'reportResolved'
  | 'reportDismissed'
  | 'offerDisabled';

type ReputationDetails = {
  reason: ReputationReason;
  sourceType: string;
  sourceId?: string;
};

@Injectable()
export class ReputationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Configured points for an event (may be negative).
  points(reason: ReputationReason): number {
    return this.config.get<number>(`reputation.${reason}`) ?? 0;
  }

  private data(userId: string, delta: number, details: ReputationDetails) {
    return {
      userId,
      delta,
      reason: details.reason,
      sourceType: details.sourceType,
      sourceId: details.sourceId ?? null,
    };
  }

  // Records a reputation change (counter + ledger entry) inside an existing
  // interactive transaction, so it stays atomic with the triggering action.
  async applyWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    delta: number,
    details: ReputationDetails,
  ): Promise<void> {
    if (delta === 0) {
      return;
    }
    await tx.user.update({
      where: { id: userId },
      data: { reputation: { increment: delta } },
    });
    await tx.reputationEvent.create({
      data: this.data(userId, delta, details),
    });
  }

  // Same effect expressed as operations to push into an array-form $transaction.
  entries(
    userId: string,
    delta: number,
    details: ReputationDetails,
  ): Prisma.PrismaPromise<unknown>[] {
    if (delta === 0) {
      return [];
    }
    return [
      this.prisma.user.update({
        where: { id: userId },
        data: { reputation: { increment: delta } },
      }),
      this.prisma.reputationEvent.create({
        data: this.data(userId, delta, details),
      }),
    ];
  }
}
