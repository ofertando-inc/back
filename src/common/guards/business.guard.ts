import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';

import type { BusinessRequest } from '../../modules/identity/business/types/business-request.type';
import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { PrismaService } from '../../prisma/prisma.service';

// Business gate: requires a BUSINESS account whose affiliation claim was
// approved (Merchant.ownerId = current user). Attaches the owned merchant to
// the request so controllers don't re-query it.
@Injectable()
export class BusinessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BusinessRequest>();
    const user = req.user;

    if (!user) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.accountType !== AccountType.BUSINESS) {
      throw new AppException(ErrorKey.AccountNotBusiness, HttpStatus.FORBIDDEN);
    }

    const merchant = await this.prisma.merchant.findFirst({
      where: { ownerId: user.id },
      select: { id: true, name: true, verified: true, blockedAt: true },
    });

    if (!merchant) {
      throw new AppException(
        ErrorKey.AccountNoAffiliation,
        HttpStatus.FORBIDDEN,
      );
    }

    req.merchant = merchant;
    return true;
  }
}
