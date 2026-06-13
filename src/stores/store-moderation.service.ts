import { HttpStatus, Injectable } from '@nestjs/common';
import { ModerationAction, ModerationTargetType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { ModerationDecisionDto } from '../moderation/dto/moderation-decision.dto';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MergeStoresDto } from './dto/merge-stores.dto';
import { storeResponseSelect } from './store-response.select';
import type { StoreResponse } from './types/store-response.type';

@Injectable()
export class StoreModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationLog: ModerationLogService,
  ) {}

  // Marks a user-submitted store as verified, recording the decision atomically.
  async verify(
    adminId: string,
    storeId: string,
    decision: ModerationDecisionDto,
  ): Promise<StoreResponse> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });

    if (!store) {
      throw new AppException(ErrorKey.StoreNotFound, HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.store.update({
        where: { id: storeId },
        data: { verified: true },
        select: storeResponseSelect,
      }),
      this.moderationLog.entry(
        adminId,
        ModerationAction.VERIFY_STORE,
        ModerationTargetType.STORE,
        storeId,
        decision,
      ),
    ]);

    return updated;
  }

  // Merges a duplicate store into a canonical one: reassigns the source's offers
  // to the target, deletes the source, and logs the decision.
  async merge(adminId: string, dto: MergeStoresDto): Promise<StoreResponse> {
    if (dto.sourceId === dto.targetId) {
      throw new AppException(
        ErrorKey.StoreMergeInvalid,
        HttpStatus.BAD_REQUEST,
      );
    }

    const [source, target] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: dto.sourceId },
        select: { id: true },
      }),
      this.prisma.store.findUnique({
        where: { id: dto.targetId },
        select: { id: true },
      }),
    ]);

    if (!source || !target) {
      throw new AppException(ErrorKey.StoreNotFound, HttpStatus.NOT_FOUND);
    }

    const results = await this.prisma.$transaction([
      this.prisma.offer.updateMany({
        where: { storeId: dto.sourceId },
        data: { storeId: dto.targetId },
      }),
      this.prisma.store.delete({ where: { id: dto.sourceId } }),
      this.moderationLog.entry(
        adminId,
        ModerationAction.MERGE_STORE,
        ModerationTargetType.STORE,
        dto.targetId,
        {
          reason: dto.reason,
          note: dto.note ?? `merged from ${dto.sourceId}`,
        },
      ),
      this.prisma.store.findUniqueOrThrow({
        where: { id: dto.targetId },
        select: storeResponseSelect,
      }),
    ]);

    return results[3];
  }
}
