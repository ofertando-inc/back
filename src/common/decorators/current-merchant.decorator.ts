import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { BusinessRequest } from '../../modules/identity/business/types/business-request.type';

// The merchant attached by BusinessGuard (the caller's affiliated brand).
export const CurrentMerchant = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<BusinessRequest>();

    return request.merchant;
  },
);
