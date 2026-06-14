import { HttpStatus, Injectable } from '@nestjs/common';
import { ModerationAction, ModerationTargetType } from '@prisma/client';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { ModerationDecisionDto } from '../moderation/dto/moderation-decision.dto';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { MergeMerchantsDto } from './dto/merge-merchants.dto';
import { locationResponseSelect } from './location-response.select';
import { merchantResponseSelect } from './merchant-response.select';
import type { LocationResponse } from './types/location-response.type';
import type { MerchantResponse } from './types/merchant-response.type';

@Injectable()
export class MerchantModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationLog: ModerationLogService,
  ) {}

  async verifyMerchant(
    adminId: string,
    id: string,
    decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!merchant) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.merchant.update({
        where: { id },
        data: { verified: true },
        select: merchantResponseSelect,
      }),
      this.moderationLog.entry(
        adminId,
        ModerationAction.VERIFY_MERCHANT,
        ModerationTargetType.MERCHANT,
        id,
        decision,
      ),
    ]);

    return updated;
  }

  async verifyLocation(
    adminId: string,
    id: string,
    decision: ModerationDecisionDto,
  ): Promise<LocationResponse> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!location) {
      throw new AppException(ErrorKey.LocationNotFound, HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.location.update({
        where: { id },
        data: { verified: true },
        select: locationResponseSelect,
      }),
      this.moderationLog.entry(
        adminId,
        ModerationAction.VERIFY_LOCATION,
        ModerationTargetType.LOCATION,
        id,
        decision,
      ),
    ]);

    return updated;
  }

  // Merges a duplicate merchant into a canonical one: moves its locations and
  // offers to the target, deletes the source, and logs the decision.
  async merge(
    adminId: string,
    dto: MergeMerchantsDto,
  ): Promise<MerchantResponse> {
    if (dto.sourceId === dto.targetId) {
      throw new AppException(
        ErrorKey.MerchantMergeInvalid,
        HttpStatus.BAD_REQUEST,
      );
    }

    const [source, target] = await Promise.all([
      this.prisma.merchant.findUnique({
        where: { id: dto.sourceId },
        select: { id: true },
      }),
      this.prisma.merchant.findUnique({
        where: { id: dto.targetId },
        select: { id: true },
      }),
    ]);

    if (!source || !target) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }

    const results = await this.prisma.$transaction([
      this.prisma.location.updateMany({
        where: { merchantId: dto.sourceId },
        data: { merchantId: dto.targetId },
      }),
      this.prisma.offer.updateMany({
        where: { merchantId: dto.sourceId },
        data: { merchantId: dto.targetId },
      }),
      this.prisma.merchant.delete({ where: { id: dto.sourceId } }),
      this.moderationLog.entry(
        adminId,
        ModerationAction.MERGE_MERCHANT,
        ModerationTargetType.MERCHANT,
        dto.targetId,
        {
          reason: dto.reason,
          note: dto.note ?? `merged from ${dto.sourceId}`,
        },
      ),
      this.prisma.merchant.findUniqueOrThrow({
        where: { id: dto.targetId },
        select: merchantResponseSelect,
      }),
    ]);

    return results[4];
  }
}
