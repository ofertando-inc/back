import { PublicUser } from '../../users/types/public-user.type';

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};
