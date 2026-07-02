import { Request } from 'express';

import { PublicUser } from '../../users/types/public-user.type';

export type AuthenticatedRequest = Request & {
  user: PublicUser;
};
