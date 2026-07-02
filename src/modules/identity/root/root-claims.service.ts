import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AccountType,
  ClaimStatus,
  ModerationAction,
  ModerationTargetType,
  Prisma,
} from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import {
  decodeCursor,
  encodeCursor,
} from '../../../common/pagination/cursor.helper';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { ModerationDecisionDto } from '../../moderation/dto/moderation-decision.dto';
import { ModerationLogService } from '../../moderation/moderation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsQueryDto } from './dto/list-claims-query.dto';
import type { ClaimResponse } from './types/claim-response.type';

type ClaimCursor = { createdAt: string; id: string };

const claimSelect = {
  id: true,
  status: true,
  note: true,
  createdAt: true,
  resolvedAt: true,
  user: { select: { id: true, email: true, username: true } },
  merchant: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, username: true } },
} satisfies Prisma.MerchantClaimSelect;

// ROOT-only affiliation decisions. Business rule: a merchant has at most one
// APPROVED claim (mirrored on Merchant.ownerId) and a business account owns at
// most one merchant.
@Injectable()
export class RootClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationLog: ModerationLogService,
  ) {}

  async list(
    query: ListClaimsQueryDto,
  ): Promise<PaginatedResult<ClaimResponse>> {
    const limit = query.limit ?? 20;
    const where: Prisma.MerchantClaimWhereInput = {};
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.cursor) {
      const cursor = decodeCursor<ClaimCursor>(query.cursor);
      const createdAt = new Date(cursor.createdAt);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: createdAt } },
            { createdAt, id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const items = await this.prisma.merchantClaim.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: claimSelect,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];
    return {
      items: trimmed,
      nextCursor:
        hasMore && last
          ? encodeCursor<ClaimCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  // Direct onboarding: creates the affiliation already APPROVED and sets the
  // merchant owner in the same transaction.
  async createApproved(
    rootId: string,
    dto: CreateClaimDto,
  ): Promise<ClaimResponse> {
    await this.assertClaimable(dto.userId, dto.merchantId);

    const id = randomUUID();
    const now = new Date();

    const [claim] = await this.prisma.$transaction([
      this.prisma.merchantClaim.create({
        data: {
          id,
          userId: dto.userId,
          merchantId: dto.merchantId,
          status: ClaimStatus.APPROVED,
          note: dto.note ?? null,
          reviewedById: rootId,
          resolvedAt: now,
        },
        select: claimSelect,
      }),
      this.prisma.merchant.update({
        where: { id: dto.merchantId },
        data: { ownerId: dto.userId },
      }),
      this.moderationLog.entry(
        rootId,
        ModerationAction.APPROVE_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        id,
        { note: dto.note },
      ),
    ]);

    return claim;
  }

  async approve(
    rootId: string,
    claimId: string,
    decision: ModerationDecisionDto,
  ): Promise<ClaimResponse> {
    const claim = await this.findPending(claimId);
    await this.assertClaimable(claim.userId, claim.merchantId);

    const [updated] = await this.prisma.$transaction([
      this.prisma.merchantClaim.update({
        where: { id: claimId },
        data: {
          status: ClaimStatus.APPROVED,
          reviewedById: rootId,
          resolvedAt: new Date(),
          ...(decision.note !== undefined && { note: decision.note }),
        },
        select: claimSelect,
      }),
      this.prisma.merchant.update({
        where: { id: claim.merchantId },
        data: { ownerId: claim.userId },
      }),
      this.moderationLog.entry(
        rootId,
        ModerationAction.APPROVE_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        claimId,
        decision,
      ),
    ]);

    return updated;
  }

  async reject(
    rootId: string,
    claimId: string,
    decision: ModerationDecisionDto,
  ): Promise<ClaimResponse> {
    const claim = await this.findPending(claimId);

    const [updated] = await this.prisma.$transaction([
      this.prisma.merchantClaim.update({
        where: { id: claim.id },
        data: {
          status: ClaimStatus.REJECTED,
          reviewedById: rootId,
          resolvedAt: new Date(),
          ...(decision.note !== undefined && { note: decision.note }),
        },
        select: claimSelect,
      }),
      this.moderationLog.entry(
        rootId,
        ModerationAction.REJECT_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        claimId,
        decision,
      ),
    ]);

    return updated;
  }

  private async findPending(claimId: string) {
    const claim = await this.prisma.merchantClaim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true, userId: true, merchantId: true },
    });
    if (!claim) {
      throw new AppException(ErrorKey.ClaimNotFound, HttpStatus.NOT_FOUND);
    }
    if (claim.status !== ClaimStatus.PENDING) {
      throw new AppException(
        ErrorKey.ClaimAlreadyResolved,
        HttpStatus.CONFLICT,
      );
    }
    return claim;
  }

  // The applicant must be a business account without an affiliation yet, and
  // the merchant must not be owned already.
  private async assertClaimable(
    userId: string,
    merchantId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountType: true },
    });
    if (!user) {
      throw new AppException(ErrorKey.AccountNotFound, HttpStatus.NOT_FOUND);
    }
    if (user.accountType !== AccountType.BUSINESS) {
      throw new AppException(
        ErrorKey.AccountNotBusiness,
        HttpStatus.BAD_REQUEST,
      );
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, ownerId: true },
    });
    if (!merchant) {
      throw new AppException(ErrorKey.MerchantNotFound, HttpStatus.NOT_FOUND);
    }
    if (merchant.ownerId !== null) {
      throw new AppException(
        ErrorKey.MerchantAlreadyOwned,
        HttpStatus.CONFLICT,
      );
    }

    const alreadyOwned = await this.prisma.merchant.findFirst({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (alreadyOwned) {
      throw new AppException(
        ErrorKey.ClaimUserAlreadyAffiliated,
        HttpStatus.CONFLICT,
      );
    }
  }
}
