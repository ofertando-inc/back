import { HttpStatus, Injectable } from '@nestjs/common';
import { OfferStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PublicUser } from './types/public-user.type';
import { UserStats } from './types/user-stats.type';

// Mirrors the cost factor used when hashing passwords at registration.
const PASSWORD_SALT_ROUNDS = 12;

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

  // Updates the authenticated user's own profile. Changing the email or the
  // password requires re-authenticating with the current password; username and
  // email must stay unique across users.
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppException(ErrorKey.UserNotFound, HttpStatus.NOT_FOUND);
    }

    const emailChanged = dto.email !== undefined && dto.email !== user.email;
    const passwordChanged = dto.password !== undefined;

    if (emailChanged || passwordChanged) {
      if (!dto.currentPassword) {
        throw new AppException(
          ErrorKey.UserCurrentPasswordRequired,
          HttpStatus.BAD_REQUEST,
        );
      }

      const valid = await bcrypt.compare(
        dto.currentPassword,
        user.passwordHash,
      );

      if (!valid) {
        throw new AppException(
          ErrorKey.UserInvalidCurrentPassword,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.username !== undefined && dto.username !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });

      if (existing && existing.id !== userId) {
        throw new AppException(
          ErrorKey.UserUsernameTaken,
          HttpStatus.BAD_REQUEST,
        );
      }

      data.username = dto.username;
    }

    if (emailChanged) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });

      if (existing && existing.id !== userId) {
        throw new AppException(ErrorKey.UserEmailTaken, HttpStatus.BAD_REQUEST);
      }

      data.email = dto.email;
    }

    if (dto.password !== undefined) {
      data.passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
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
