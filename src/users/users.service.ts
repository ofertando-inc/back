import { Injectable } from '@nestjs/common';
import { OfferStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser } from './types/public-user.type';
import { UserStats } from './types/user-stats.type';

type CreateUserData = {
  email: string;
  username: string;
  passwordHash: string;
};

@Injectable()
export class UsersService {
  private readonly publicUserSelect = {
    id: true,
    email: true,
    username: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.UserSelect;

  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateUserData): Promise<PublicUser> {
    return this.prisma.user.create({
      data,
      select: this.publicUserSelect,
    });
  }

  findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: this.publicUserSelect,
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findByUsername(username: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { username },
      select: this.publicUserSelect,
    });
  }

  async getStats(userId: string): Promise<UserStats> {
    const [offerCount, commentCount] = await Promise.all([
      this.prisma.offer.count({
        where: { createdById: userId, status: { not: OfferStatus.DELETED } },
      }),
      this.prisma.comment.count({ where: { userId, deletedAt: null } }),
    ]);

    return { offerCount, commentCount };
  }
}
