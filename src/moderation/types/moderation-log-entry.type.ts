import { ModerationAction, ModerationTargetType } from '@prisma/client';

export type ModerationLogEntry = {
  id: string;
  action: ModerationAction;
  targetType: ModerationTargetType;
  targetId: string;
  reason: string | null;
  note: string | null;
  createdAt: Date;
  actor: { id: string; username: string };
};
