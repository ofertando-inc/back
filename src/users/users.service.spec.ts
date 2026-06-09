import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { ErrorKey } from '../common/exceptions/error-keys';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');

const mockedCompare = bcrypt.compare as jest.Mock;
const mockedHash = bcrypt.hash as jest.Mock;

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    offer: { count: jest.Mock };
    comment: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      offer: { count: jest.fn() },
      comment: { count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
    mockedCompare.mockReset();
    mockedHash.mockReset();
  });

  describe('getStats', () => {
    it('counts the user non-deleted offers and comments', async () => {
      prisma.offer.count.mockResolvedValue(3);
      prisma.comment.count.mockResolvedValue(7);

      const result = await service.getStats('user-1');

      expect(prisma.offer.count).toHaveBeenCalledWith({
        where: { createdById: 'user-1', status: { not: OfferStatus.DELETED } },
      });
      expect(prisma.comment.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
      });
      expect(result).toEqual({ offerCount: 3, commentCount: 7 });
    });
  });

  describe('updateProfile', () => {
    const currentUser = {
      id: 'user-1',
      email: 'old@example.com',
      username: 'old',
      passwordHash: 'stored-hash',
    };

    it('updates the username after a uniqueness check, without requiring the current password', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(currentUser) // load self
        .mockResolvedValueOnce(null); // username free
      prisma.user.update.mockResolvedValue({ id: 'user-1', username: 'new' });

      await service.updateProfile('user-1', { username: 'new' });

      expect(mockedCompare).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { username: 'new' },
        }),
      );
    });

    it('rejects a username already taken by another user', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(currentUser)
        .mockResolvedValueOnce({ id: 'user-2', username: 'new' });

      await expect(
        service.updateProfile('user-1', { username: 'new' }),
      ).rejects.toMatchObject({ key: ErrorKey.UserUsernameTaken });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('requires the current password to change the email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(currentUser);

      await expect(
        service.updateProfile('user-1', { email: 'new@example.com' }),
      ).rejects.toMatchObject({ key: ErrorKey.UserCurrentPasswordRequired });
    });

    it('rejects a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(currentUser);
      mockedCompare.mockResolvedValue(false);

      await expect(
        service.updateProfile('user-1', {
          password: 'newpassword',
          currentPassword: 'wrong',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.UserInvalidCurrentPassword });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changes the email after verifying the current password and uniqueness', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(currentUser) // load self
        .mockResolvedValueOnce(null); // email free
      mockedCompare.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
      });

      await service.updateProfile('user-1', {
        email: 'new@example.com',
        currentPassword: 'good',
      });

      expect(mockedCompare).toHaveBeenCalledWith('good', 'stored-hash');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { email: 'new@example.com' } }),
      );
    });

    it('hashes the new password before persisting it', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(currentUser);
      mockedCompare.mockResolvedValue(true);
      mockedHash.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({ id: 'user-1' });

      await service.updateProfile('user-1', {
        password: 'newpassword',
        currentPassword: 'good',
      });

      expect(mockedHash).toHaveBeenCalledWith('newpassword', 12);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { passwordHash: 'new-hash' } }),
      );
    });

    it('throws user.not_found when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateProfile('ghost', { username: 'x' }),
      ).rejects.toMatchObject({ key: ErrorKey.UserNotFound });
    });
  });
});
