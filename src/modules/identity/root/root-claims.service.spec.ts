import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountType,
  ClaimStatus,
  ModerationAction,
  ModerationTargetType,
} from '@prisma/client';

import { ErrorKey } from '../../../common/exceptions/error-keys';
import { ModerationLogService } from '../../moderation/moderation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RootClaimsService } from './root-claims.service';

describe('RootClaimsService', () => {
  let service: RootClaimsService;
  let user: { findUnique: jest.Mock };
  let merchant: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  let merchantClaim: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let moderationLog: { entry: jest.Mock };
  let prisma: {
    user: typeof user;
    merchant: typeof merchant;
    merchantClaim: typeof merchantClaim;
    $transaction: jest.Mock;
  };

  const businessUser = { id: 'biz-1', accountType: AccountType.BUSINESS };
  const freeMerchant = { id: 'm1', ownerId: null };

  beforeEach(async () => {
    user = { findUnique: jest.fn() };
    merchant = {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    };
    merchantClaim = {
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
      merchant,
      merchantClaim,
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RootClaimsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationLogService, useValue: moderationLog },
      ],
    }).compile();

    service = module.get(RootClaimsService);
  });

  describe('createApproved', () => {
    it('creates an APPROVED claim, sets the merchant owner and logs it', async () => {
      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue(freeMerchant);
      merchant.findFirst.mockResolvedValue(null);
      merchantClaim.create.mockResolvedValue({ id: 'c1' });
      merchant.update.mockResolvedValue({ id: 'm1', ownerId: 'biz-1' });

      await service.createApproved('root-1', {
        userId: 'biz-1',
        merchantId: 'm1',
        note: 'onboarding',
      });

      const calls = merchantClaim.create.mock.calls as unknown[][];
      const createArgs = calls[0]?.[0] as {
        data: { id: string; status: ClaimStatus; reviewedById: string };
      };
      expect(createArgs.data.status).toBe(ClaimStatus.APPROVED);
      expect(createArgs.data.reviewedById).toBe('root-1');
      expect(merchant.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { ownerId: 'biz-1' },
      });
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'root-1',
        ModerationAction.APPROVE_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        createArgs.data.id,
        { note: 'onboarding' },
      );
    });

    it('rejects a non-business applicant with account.not_business', async () => {
      user.findUnique.mockResolvedValue({
        id: 'u1',
        accountType: AccountType.INDIVIDUAL,
      });

      await expect(
        service.createApproved('root-1', { userId: 'u1', merchantId: 'm1' }),
      ).rejects.toMatchObject({ key: ErrorKey.AccountNotBusiness });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an already-owned merchant with merchant.already_owned', async () => {
      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'other' });

      await expect(
        service.createApproved('root-1', { userId: 'biz-1', merchantId: 'm1' }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantAlreadyOwned });
    });

    it('rejects an applicant that already owns a merchant (one brand per business)', async () => {
      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue(freeMerchant);
      merchant.findFirst.mockResolvedValue({ id: 'other-merchant' });

      await expect(
        service.createApproved('root-1', { userId: 'biz-1', merchantId: 'm1' }),
      ).rejects.toMatchObject({ key: ErrorKey.ClaimUserAlreadyAffiliated });
    });

    it('throws account.not_found / merchant.not_found on missing sides', async () => {
      user.findUnique.mockResolvedValue(null);
      await expect(
        service.createApproved('root-1', { userId: 'ghost', merchantId: 'm1' }),
      ).rejects.toMatchObject({ key: ErrorKey.AccountNotFound });

      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue(null);
      await expect(
        service.createApproved('root-1', {
          userId: 'biz-1',
          merchantId: 'ghost',
        }),
      ).rejects.toMatchObject({ key: ErrorKey.MerchantNotFound });
    });
  });

  describe('approve', () => {
    const pendingClaim = {
      id: 'c1',
      status: ClaimStatus.PENDING,
      userId: 'biz-1',
      merchantId: 'm1',
    };

    it('approves a pending claim, sets the owner and logs the decision', async () => {
      merchantClaim.findUnique.mockResolvedValue(pendingClaim);
      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue(freeMerchant);
      merchant.findFirst.mockResolvedValue(null);
      merchantClaim.update.mockResolvedValue({
        id: 'c1',
        status: ClaimStatus.APPROVED,
      });
      merchant.update.mockResolvedValue({ id: 'm1', ownerId: 'biz-1' });

      await service.approve('root-1', 'c1', { reason: 'verified papers' });

      const updCalls = merchantClaim.update.mock.calls as unknown[][];
      const updateArgs = updCalls[0]?.[0] as {
        data: { status: ClaimStatus; reviewedById: string };
      };
      expect(updateArgs.data.status).toBe(ClaimStatus.APPROVED);
      expect(updateArgs.data.reviewedById).toBe('root-1');
      expect(merchant.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { ownerId: 'biz-1' },
      });
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'root-1',
        ModerationAction.APPROVE_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        'c1',
        { reason: 'verified papers' },
      );
    });

    it('throws claim.not_found when missing', async () => {
      merchantClaim.findUnique.mockResolvedValue(null);

      await expect(
        service.approve('root-1', 'ghost', {}),
      ).rejects.toMatchObject({ key: ErrorKey.ClaimNotFound });
    });

    it('throws claim.already_resolved on a non-pending claim', async () => {
      merchantClaim.findUnique.mockResolvedValue({
        ...pendingClaim,
        status: ClaimStatus.REJECTED,
      });

      await expect(service.approve('root-1', 'c1', {})).rejects.toMatchObject({
        key: ErrorKey.ClaimAlreadyResolved,
      });
    });

    it('throws merchant.already_owned when the merchant got an owner meanwhile', async () => {
      merchantClaim.findUnique.mockResolvedValue(pendingClaim);
      user.findUnique.mockResolvedValue(businessUser);
      merchant.findUnique.mockResolvedValue({ id: 'm1', ownerId: 'other' });

      await expect(service.approve('root-1', 'c1', {})).rejects.toMatchObject({
        key: ErrorKey.MerchantAlreadyOwned,
      });
    });
  });

  describe('reject', () => {
    it('rejects a pending claim with the note and logs it', async () => {
      merchantClaim.findUnique.mockResolvedValue({
        id: 'c1',
        status: ClaimStatus.PENDING,
        userId: 'biz-1',
        merchantId: 'm1',
      });
      merchantClaim.update.mockResolvedValue({
        id: 'c1',
        status: ClaimStatus.REJECTED,
      });

      await service.reject('root-1', 'c1', { note: 'no proof of ownership' });

      const updCalls = merchantClaim.update.mock.calls as unknown[][];
      const updateArgs = updCalls[0]?.[0] as {
        data: { status: ClaimStatus; note: string };
      };
      expect(updateArgs.data.status).toBe(ClaimStatus.REJECTED);
      expect(updateArgs.data.note).toBe('no proof of ownership');
      expect(merchant.update).not.toHaveBeenCalled();
      expect(moderationLog.entry).toHaveBeenCalledWith(
        'root-1',
        ModerationAction.REJECT_MERCHANT_CLAIM,
        ModerationTargetType.MERCHANT_CLAIM,
        'c1',
        { note: 'no proof of ownership' },
      );
    });

    it('throws claim.already_resolved on a resolved claim', async () => {
      merchantClaim.findUnique.mockResolvedValue({
        id: 'c1',
        status: ClaimStatus.APPROVED,
        userId: 'biz-1',
        merchantId: 'm1',
      });

      await expect(service.reject('root-1', 'c1', {})).rejects.toMatchObject({
        key: ErrorKey.ClaimAlreadyResolved,
      });
    });
  });

  describe('list', () => {
    it('filters by status, newest first, with user and merchant embedded', async () => {
      merchantClaim.findMany.mockResolvedValue([]);

      await service.list({ status: ClaimStatus.PENDING, limit: 20 });

      expect(merchantClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ClaimStatus.PENDING },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
        }),
      );
    });
  });
});
