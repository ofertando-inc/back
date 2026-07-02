import type { PublicUser } from '../../identity/users/types/public-user.type';
import type { ModerationLogEntry } from './moderation-log-entry.type';

export type AdminUserDetail = PublicUser & {
  counts: { offers: number; comments: number };
  moderationHistory: ModerationLogEntry[];
};
