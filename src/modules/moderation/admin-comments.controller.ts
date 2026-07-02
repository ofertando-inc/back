import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../../common/pagination/paginated-result.type';
import type { PublicUser } from '../identity/users/types/public-user.type';
import { ListReportedCommentsQueryDto } from './dto/list-reported-comments-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { ModerationService } from './moderation.service';
import type { CommentModerationSummary } from './types/comment-moderation-summary.type';
import type { CommentReportDetail } from './types/report-detail.type';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/comments')
export class AdminCommentsController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  list(
    @Query() query: ListReportedCommentsQueryDto,
  ): Promise<PaginatedResult<CommentModerationSummary>> {
    return this.moderationService.listReportedComments(query);
  }

  @Get(':id/reports')
  reports(
    @Param('id') id: string,
    @Query() query: ListReportsQueryDto,
  ): Promise<PaginatedResult<CommentReportDetail>> {
    return this.moderationService.listCommentReports(id, query);
  }

  @Patch(':id/hide')
  hide(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
    @Body() decision: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
    return this.moderationService.hideComment(id, admin.id, decision);
  }

  @Patch(':id/dismiss')
  dismiss(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
    @Body() decision: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
    return this.moderationService.dismissComment(id, admin.id, decision);
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
    @CurrentUser() admin: PublicUser,
    @Body() decision: ModerationDecisionDto,
  ): Promise<CommentModerationSummary> {
    return this.moderationService.restoreComment(id, admin.id, decision);
  }
}
