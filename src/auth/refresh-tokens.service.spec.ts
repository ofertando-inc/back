import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshToken } from '@prisma/client';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokensService } from './refresh-tokens.service';

function buildToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'jti-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    replacedById: null,
    ...overrides,
  };
}

type PrismaRefreshTokenMock = {
  create: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

describe('RefreshTokensService', () => {
  let service: RefreshTokensService;
  let prismaToken: PrismaRefreshTokenMock;
  let prisma: { refreshToken: PrismaRefreshTokenMock; $transaction: jest.Mock };
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    prismaToken = {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    prisma = {
      refreshToken: prismaToken,
      $transaction: jest.fn((cb: (tx: typeof prisma) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokensService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RefreshTokensService);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('issue', () => {
    it('creates a new row with a UUID id and the computed expiresAt', async () => {
      prismaToken.create.mockResolvedValue(buildToken());

      const result = await service.issue('user-42', 1000 * 60 * 60);

      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(prismaToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: result.id,
          userId: 'user-42',
          expiresAt: result.expiresAt,
        }) as unknown as never,
      });
    });
  });

  describe('validate', () => {
    it('returns the token when found, unexpired and not revoked', async () => {
      const token = buildToken();
      prismaToken.findUnique.mockResolvedValue(token);

      await expect(service.validate('jti-1')).resolves.toBe(token);
    });

    it('throws auth.unauthorized when the token is not in the DB', async () => {
      prismaToken.findUnique.mockResolvedValue(null);

      await expect(service.validate('missing')).rejects.toMatchObject({
        key: ErrorKey.AuthUnauthorized,
      });
    });

    it('throws auth.unauthorized when the token is expired', async () => {
      prismaToken.findUnique.mockResolvedValue(
        buildToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.validate('jti-1')).rejects.toMatchObject({
        key: ErrorKey.AuthUnauthorized,
      });
    });

    it('throws auth.unauthorized when the token is revoked but not replaced', async () => {
      prismaToken.findUnique.mockResolvedValue(
        buildToken({ revokedAt: new Date() }),
      );

      await expect(service.validate('jti-1')).rejects.toMatchObject({
        key: ErrorKey.AuthUnauthorized,
      });
      expect(prismaToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes all user sessions when an already-rotated token is replayed', async () => {
      prismaToken.findUnique.mockResolvedValue(
        buildToken({
          revokedAt: new Date(),
          replacedById: 'jti-next',
        }),
      );

      await expect(service.validate('jti-1')).rejects.toMatchObject({
        key: ErrorKey.AuthUnauthorized,
      });

      expect(prismaToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as never },
      });
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('creates a new row and marks the old one as replaced inside a transaction', async () => {
      await service.rotate('jti-old', 'user-1', 1000 * 60);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prismaToken.create).toHaveBeenCalled();
      expect(prismaToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'jti-old' },
          data: expect.objectContaining({
            replacedById: expect.any(String) as unknown as never,
            revokedAt: expect.any(Date) as unknown as never,
          }) as unknown as never,
        }) as unknown as never,
      );
    });
  });

  describe('revoke', () => {
    it('marks the row as revoked only if not already revoked', async () => {
      await service.revoke('jti-1');

      expect(prismaToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'jti-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as never },
      });
    });
  });

  describe('revokeAllForUser', () => {
    it('marks every non-revoked token for the user as revoked', async () => {
      await service.revokeAllForUser('user-1');

      expect(prismaToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as never },
      });
    });
  });
});
