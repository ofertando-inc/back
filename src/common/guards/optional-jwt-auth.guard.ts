import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import type { PublicUser } from '../../users/types/public-user.type';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = PublicUser>(
    _err: unknown,
    user: TUser | false | null,
  ): TUser | undefined {
    return user || undefined;
  }
}
