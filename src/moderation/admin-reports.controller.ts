import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationService } from './moderation.service';
import type { ReportSummary } from './types/report-summary.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  list(
    @Query() query: ListReportsQueryDto,
  ): Promise<PaginatedResult<ReportSummary>> {
    return this.moderationService.listReports(query);
  }
}
