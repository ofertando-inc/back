import { HttpStatus, Injectable } from '@nestjs/common';
import { ModerationAction, ModerationTargetType, Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import {
  decodeCursor,
  encodeCursor,
} from '../../../common/pagination/cursor.helper';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import { ModerationDecisionDto } from '../../moderation/dto/moderation-decision.dto';
import { ModerationLogService } from '../../moderation/moderation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ListAdminLocationsQueryDto } from './dto/list-admin-locations-query.dto';
import { ListAdminMerchantsQueryDto } from './dto/list-admin-merchants-query.dto';
import { MergeMerchantsDto } from './dto/merge-merchants.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { locationResponseSelect } from './location-response.select';
import { merchantResponseSelect } from './merchant-response.select';
import { normalizeMerchantName } from './normalize';
import type { AdminLocation } from './types/admin-location.type';
import type { LocationResponse } from './types/location-response.type';
import type { MerchantResponse } from './types/merchant-response.type';

type AdminCursor = { createdAt: string; id: string };

@Injectable()
export class MerchantModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationLog: ModerationLogService,
  ) {}

  // Admin moderation queue of merchants (newest first); verified=false lists the
  // ones awaiting review.
  async listMerchants(
    query: ListAdminMerchantsQueryDto,
  ): Promise<PaginatedResult<MerchantResponse>> {
    const limit = query.limit ?? 20;
    const where: Prisma.MerchantWhereInput = {};
    if (query.verified !== undefined) {
      where.verified = query.verified;
    }
    if (query.blocked !== undefined) {
      where.blockedAt = query.blocked ? { not: null } : null;
    }
    if (query.q) {
      where.nameNormalized = { contains: normalizeMerchantName(query.q) };
    }
    if (query.cursor) {
      where.AND = [this.cursorWhere(decodeCursor<AdminCursor>(query.cursor))];
    }

    const items = await this.prisma.merchant.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: merchantResponseSelect,
    });

    return this.paginate(items, limit);
  }

  // Admin moderation queue of locations (newest first), each with its merchant.
  async listLocations(
    query: ListAdminLocationsQueryDto,
  ): Promise<PaginatedResult<AdminLocation>> {
    const limit = query.limit ?? 20;
    const where: Prisma.LocationWhereInput = {};
    if (query.verified !== undefined) {
      where.verified = query.verified;
    }
    if (query.merchant) {
      where.merchantId = query.merchant;
    }
    if (query.cursor) {
      where.AND = [this.cursorWhere(decodeCursor<AdminCursor>(query.cursor))];
    }

    const items = await this.prisma.location.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        ...locationResponseSelect,
        merchant: { select: { id: true, name: true } },
      },
    });

    return this.paginate(items, limit);
  }

  private cursorWhere(cursor: AdminCursor) {
    const createdAt = new Date(cursor.createdAt);
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  private paginate<T extends { id: string; createdAt: Date }>(
    items: T[],
    limit: number,
  ): PaginatedResult<T> {
    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];
    return {
      items: trimmed,
      nextCursor:
        hasMore && last
          ? encodeCursor<AdminCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

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

  // Blocks a merchant: it leaves public circulation and its offers are shown as
  // blocked (derived from blockedAt). Reversible via unblock.
  async block(
    adminId: string,
    id: string,
    decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    return this.setBlocked(
      adminId,
      id,
      new Date(),
      ModerationAction.BLOCK_MERCHANT,
      decision,
    );
  }

  async unblock(
    adminId: string,
    id: string,
    decision: ModerationDecisionDto,
  ): Promise<MerchantResponse> {
    return this.setBlocked(
      adminId,
      id,
      null,
      ModerationAction.UNBLOCK_MERCHANT,
      decision,
    );
  }

  private async setBlocked(
    adminId: string,
    id: string,
    blockedAt: Date | null,
    action: ModerationAction,
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
        data: { blockedAt },
        select: merchantResponseSelect,
      }),
      this.moderationLog.entry(
        adminId,
        action,
        ModerationTargetType.MERCHANT,
        id,
        decision,
      ),
    ]);

    return updated;
  }

  // Renames a merchant (recomputing the normalized name); rejects a name that
  // collides with another merchant (use merge for duplicates).
  async updateMerchant(
    id: string,
    dto: UpdateMerchantDto,
  ): Promise<MerchantResponse> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!merchant) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }

    const data: Prisma.MerchantUpdateInput = {};
    if (dto.name !== undefined) {
      const nameNormalized = normalizeMerchantName(dto.name);
      const clash = await this.prisma.merchant.findFirst({
        where: { nameNormalized, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new AppException(
          ErrorKey.MerchantNameTaken,
          HttpStatus.BAD_REQUEST,
        );
      }
      data.name = dto.name.trim();
      data.nameNormalized = nameNormalized;
    }

    return this.prisma.merchant.update({
      where: { id },
      data,
      select: merchantResponseSelect,
    });
  }

  // Edits a location; keeps the offers' denormalized city in sync when it changes.
  async updateLocation(
    id: string,
    dto: UpdateLocationDto,
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
        data: {
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.region !== undefined && { region: dto.region }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
        },
        select: locationResponseSelect,
      }),
      ...(dto.city !== undefined
        ? [
            this.prisma.offer.updateMany({
              where: { locationId: id },
              data: { city: dto.city },
            }),
          ]
        : []),
    ]);

    return updated;
  }

  // Deletes a location. With offers attached, requires a same-merchant
  // reassignment target (so physical offers never lose their address).
  async deleteLocation(id: string, reassignTo?: string): Promise<void> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      select: { id: true, merchantId: true },
    });
    if (!location) {
      throw new AppException(ErrorKey.LocationNotFound, HttpStatus.NOT_FOUND);
    }

    const offerCount = await this.prisma.offer.count({
      where: { locationId: id },
    });

    if (offerCount === 0) {
      await this.prisma.location.delete({ where: { id } });
      return;
    }

    if (!reassignTo) {
      throw new AppException(ErrorKey.LocationInUse, HttpStatus.CONFLICT);
    }

    const target = await this.prisma.location.findUnique({
      where: { id: reassignTo },
      select: { id: true, merchantId: true, city: true },
    });
    if (!target || target.merchantId !== location.merchantId) {
      throw new AppException(ErrorKey.LocationNotFound, HttpStatus.NOT_FOUND);
    }

    await this.prisma.$transaction([
      this.prisma.offer.updateMany({
        where: { locationId: id },
        data: { locationId: reassignTo, city: target.city },
      }),
      this.prisma.location.delete({ where: { id } }),
    ]);
  }
}
