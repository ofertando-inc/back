import { UserRole, UserStatus } from '../../../generated/prisma/client';

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};
