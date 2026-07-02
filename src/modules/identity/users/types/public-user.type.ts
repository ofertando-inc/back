import { AccountType, UserRole, UserStatus } from '@prisma/client';

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  accountType: AccountType;
  status: UserStatus;
  reputation: number;
  createdAt: Date;
  updatedAt: Date;
};
