import { Test, TestingModule } from '@nestjs/testing';
import { ModerationAction, ModerationTargetType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ModerationLogService } from './moderation-log.service';

describe('ModerationLogService', () => {
  let service: ModerationLogService;
  let moderationLog: { create: jest.Mock };

  beforeEach(async () => {
    moderationLog = { create: jest.fn().mockReturnValue('create-promise') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationLogService,
        { provide: PrismaService, useValue: { moderationLog } },
      ],
    }).compile();

    service = module.get(ModerationLogService);
  });

  it('builds a moderationLog create with the decision, defaulting reason/note to null', () => {
    const result = service.entry(
      'admin-1',
      ModerationAction.VERIFY_STORE,
      ModerationTargetType.STORE,
      'store-1',
    );

    expect(moderationLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: ModerationAction.VERIFY_STORE,
        targetType: ModerationTargetType.STORE,
        targetId: 'store-1',
        reason: null,
        note: null,
      },
    });
    expect(result).toBe('create-promise');
  });

  it('passes through the provided reason and note', () => {
    void service.entry(
      'admin-1',
      ModerationAction.MERGE_STORE,
      ModerationTargetType.STORE,
      'target-1',
      { reason: 'dup', note: 'merged from source-1' },
    );

    expect(moderationLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: ModerationAction.MERGE_STORE,
        targetType: ModerationTargetType.STORE,
        targetId: 'target-1',
        reason: 'dup',
        note: 'merged from source-1',
      },
    });
  });
});
