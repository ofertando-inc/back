import { UserRole } from '../../../generated/prisma/client';

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};
