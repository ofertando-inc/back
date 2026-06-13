import { Injectable } from '@nestjs/common';
import { ModerationAction, ModerationTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type LogDecision = { reason?: string; note?: string };

@Injectable()
export class ModerationLogService {
  constructor(private readonly prisma: PrismaService) {}

  // Builds a moderation-log create to push into an action's transaction, so the
  // decision (actor, reason, note) is recorded atomically with its effect.
  // Reusable by any module that performs admin actions (comments, offers,
  // users, stores).
  entry(
    actorId: string,
    action: ModerationAction,
    targetType: ModerationTargetType,
    targetId: string,
    decision?: LogDecision,
  ): Prisma.PrismaPromise<unknown> {
    return this.prisma.moderationLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        reason: decision?.reason ?? null,
        note: decision?.note ?? null,
      },
    });
  }
}
