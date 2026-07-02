import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountType,
  ModerationAction,
  ModerationTargetType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ErrorKey } from '../../../common/exceptions/error-keys';
import { ModerationLogService } from '../../moderation/moderation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RootAccountsService } from './root-accounts.service';

describe('RootAccountsService', () => {
  let service: RootAccountsService;
  let user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let moderationLog: { entry: jest.Mock };
  let prisma: { user: typeof user; $transaction: jest.Mock };

  beforeEach(async () => {
    user = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    moderationLog = {
      entry: jest.fn().mockReturnValue(Promise.resolve('log')),
    };
    prisma = {
      user,
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RootAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationLogService, useValue: moderationLog },
      ],
    }).compile();

    service = module.get(RootAccountsService);
  });

  describe('create', () => {
    it('creates a business account with a hashed password and logs CREATE_ACCOUNT', async () => {
      user.findUnique.mockResolvedValue(null);
      user.create.mockResolvedValue({ id: 'new-1', email: 'b@corp.co' });

      await service.create('root-1', {
        email: 'b@corp.co',
        username: 'corp',
        password: 'provisional123',
        accountType: AccountType.BUSINESS,
      });

      const calls = user.create.mock.calls as unknown[][];
      const createArgs = calls[0]?.[0] as {
        data: {
          id: string;
          passwordHash: string;
          accountType: AccountType;
          email: string;
        };
      };
      expect(createArgs.data.accountType).toBe(AccountType.BUSINESS);
      expect(createArgs.data.passwordHash).not.toBe('provisional123');
      await expect(
        bcrypt.compare('provisional123', createArgs.data.passwordHash),
      ).resolves.toBe(true);
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'root-1',
        ModerationAction.CREATE_ACCOUNT,
        ModerationTargetType.USER,
        createArgs.data.id,
      );
    });

    it('rejects a taken email with user.email_taken', async () => {
      user.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.create('root-1', {
          email: 'taken@b.co',
          username: 'x',
          password: 'password123',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.UserEmailTaken });
      expect(user.create).not.toHaveBeenCalled();
    });

    it('rejects a taken username with user.username_taken', async () => {
      user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.create('root-1', {
          email: 'new@b.co',
          username: 'taken',
          password: 'password123',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.UserUsernameTaken });
    });
  });

  describe('update', () => {
    it('updates role/status and logs UPDATE_ACCOUNT', async () => {
      user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.co',
        username: 'a',
      });
      user.update.mockResolvedValue({ id: 'u1', role: UserRole.ADMIN });

      await service.update('root-1', 'u1', {
        role: UserRole.ADMIN,
        status: UserStatus.DISABLED,
      });

      expect(user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { role: UserRole.ADMIN, status: UserStatus.DISABLED },
        }),
      );
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'root-1',
        ModerationAction.UPDATE_ACCOUNT,
        ModerationTargetType.USER,
        'u1',
      );
    });

    it('throws account.not_found when missing', async () => {
      user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('root-1', 'ghost', { role: UserRole.ADMIN }),
      ).rejects.toMatchObject({ key: ErrorKey.AccountNotFound });
    });

    it('rejects an email already used by another account', async () => {
      user.findUnique
        .mockResolvedValueOnce({ id: 'u1', email: 'old@b.co', username: 'a' })
        .mockResolvedValueOnce({ id: 'other' });

      await expect(
        service.update('root-1', 'u1', { email: 'taken@b.co' }),
      ).rejects.toMatchObject({ key: ErrorKey.UserEmailTaken });
    });
  });

  describe('list', () => {
    it('filters by q, role, accountType and status, newest first', async () => {
      user.findMany.mockResolvedValue([]);

      await service.list({
        q: 'corp',
        role: UserRole.USER,
        accountType: AccountType.BUSINESS,
        status: UserStatus.ACTIVE,
        limit: 20,
      });

      expect(user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: { contains: 'corp', mode: 'insensitive' } },
              { username: { contains: 'corp', mode: 'insensitive' } },
            ],
            role: UserRole.USER,
            accountType: AccountType.BUSINESS,
            status: UserStatus.ACTIVE,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
    });

    it('returns a cursor when there are more rows than the limit', async () => {
      user.findMany.mockResolvedValue([
        { id: 'u1', createdAt: new Date('2024-02-01T00:00:00Z') },
        { id: 'u2', createdAt: new Date('2024-01-01T00:00:00Z') },
      ]);

      const result = await service.list({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    });
  });
});
