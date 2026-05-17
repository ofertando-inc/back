import { Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { ErrorKey } from '../../common/exceptions/error-keys';
import { OwnerGuard } from '../../common/guards/owner.guard';
import { OffersService } from '../offers.service';

@Injectable()
export class OfferOwnerGuard extends OwnerGuard {
  protected readonly notFoundKey = ErrorKey.OfferNotFound;
  protected readonly forbiddenKey = ErrorKey.OfferForbidden;

  constructor(private readonly offersService: OffersService) {
    super();
  }

  protected async resolveOwnerId(
    req: AuthenticatedRequest,
  ): Promise<string | null> {
    const id = req.params.id;
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const offer = await this.offersService.findRawById(id);
    return offer?.createdById ?? null;
  }
}
