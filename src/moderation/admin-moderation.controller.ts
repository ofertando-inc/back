import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListModerationLogQueryDto } from './dto/list-moderation-log-query.dto';
import { ModerationService } from './moderation.service';
import type { ModerationLogEntry } from './types/moderation-log-entry.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/moderation')
export class AdminModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get('log')
  log(
    @Query() query: ListModerationLogQueryDto,
  ): Promise<PaginatedResult<ModerationLogEntry>> {
    return this.moderationService.listModerationLog(query);
  }
}
