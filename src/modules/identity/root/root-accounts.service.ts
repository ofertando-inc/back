import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { ModerationAction, ModerationTargetType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import {
  decodeCursor,
  encodeCursor,
} from '../../../common/pagination/cursor.helper';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { ModerationLogService } from '../../moderation/moderation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateAccountDto } from './dto/create-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// Mirrors the cost factor used when hashing passwords at registration.
const PASSWORD_SALT_ROUNDS = 12;

type AccountCursor = { createdAt: string; id: string };

const accountSelect = {
  id: true,
  email: true,
  username: true,
  role: true,
  accountType: true,
  status: true,
  reputation: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// ROOT-only account management: roots create every account (there is no
// business self-registration) and every decision lands in the moderation log.
@Injectable()
export class RootAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationLog: ModerationLogService,
  ) {}

  async list(
    query: ListAccountsQueryDto,
  ): Promise<PaginatedResult<PublicUser>> {
    const limit = query.limit ?? 20;
    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: 'insensitive' } },
        { username: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.role !== undefined) {
      where.role = query.role;
    }
    if (query.accountType !== undefined) {
      where.accountType = query.accountType;
    }
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.cursor) {
      const cursor = decodeCursor<AccountCursor>(query.cursor);
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

    const items = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: accountSelect,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const last = trimmed[trimmed.length - 1];
    return {
      items: trimmed,
      nextCursor:
        hasMore && last
          ? encodeCursor<AccountCursor>({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async create(rootId: string, dto: CreateAccountDto): Promise<PublicUser> {
    await this.assertEmailFree(dto.email);
    await this.assertUsernameFree(dto.username);

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    // The id is generated app-side so the audit entry can join the same
    // transaction as the creation.
    const id = randomUUID();

    const [user] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          id,
          email: dto.email,
          username: dto.username,
          passwordHash,
          ...(dto.accountType !== undefined && {
            accountType: dto.accountType,
          }),
          ...(dto.role !== undefined && { role: dto.role }),
        },
        select: accountSelect,
      }),
      this.moderationLog.entry(
        rootId,
        ModerationAction.CREATE_ACCOUNT,
        ModerationTargetType.USER,
        id,
      ),
    ]);

    return user;
  }

  async update(
    rootId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true },
    });
    if (!user) {
      throw new AppException(ErrorKey.AccountNotFound, HttpStatus.NOT_FOUND);
    }

    if (dto.email !== undefined && dto.email !== user.email) {
      await this.assertEmailFree(dto.email);
    }
    if (dto.username !== undefined && dto.username !== user.username) {
      await this.assertUsernameFree(dto.username);
    }

    const data: Prisma.UserUpdateInput = {
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.username !== undefined && { username: dto.username }),
      ...(dto.accountType !== undefined && { accountType: dto.accountType }),
      ...(dto.role !== undefined && { role: dto.role }),
      ...(dto.status !== undefined && { status: dto.status }),
    };
    if (dto.password !== undefined) {
      data.passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data, select: accountSelect }),
      this.moderationLog.entry(
        rootId,
        ModerationAction.UPDATE_ACCOUNT,
        ModerationTargetType.USER,
        id,
      ),
    ]);

    return updated;
  }

  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new AppException(ErrorKey.UserEmailTaken, HttpStatus.BAD_REQUEST);
    }
  }

  private async assertUsernameFree(username: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing) {
      throw new AppException(
        ErrorKey.UserUsernameTaken,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
