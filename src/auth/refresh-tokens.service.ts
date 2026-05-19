import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RefreshToken } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedRefreshToken {
  id: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  async issue(
    userId: string,
    expiresInMs: number,
  ): Promise<IssuedRefreshToken> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInMs);

    await this.prisma.refreshToken.create({
      data: { id, userId, expiresAt },
    });

    return { id, expiresAt };
  }

  async validate(jti: string): Promise<RefreshToken> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: jti },
    });

    if (!token) {
      throw this.unauthorized();
    }

    if (token.expiresAt.getTime() <= Date.now()) {
      throw this.unauthorized();
    }

    if (token.revokedAt !== null) {
      if (token.replacedById !== null) {
        this.logger.warn(
          `Refresh token reuse detected for user ${token.userId} (jti ${jti}); revoking all sessions`,
        );
        await this.revokeAllForUser(token.userId);
      }
      throw this.unauthorized();
    }

    return token;
  }

  async rotate(
    oldJti: string,
    userId: string,
    expiresInMs: number,
  ): Promise<IssuedRefreshToken> {
    const newId = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInMs);

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.create({
        data: { id: newId, userId, expiresAt },
      });
      await tx.refreshToken.update({
        where: { id: oldJti },
        data: { revokedAt: new Date(), replacedById: newId },
      });
    });

    return { id: newId, expiresAt };
  }

  async revoke(jti: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id: jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private unauthorized(): AppException {
    return new AppException(ErrorKey.AuthUnauthorized, HttpStatus.UNAUTHORIZED);
  }
}
