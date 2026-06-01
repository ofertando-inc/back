import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import { ListReportedCommentsQueryDto } from './dto/list-reported-comments-query.dto';
import { ModerationService } from './moderation.service';
import type { CommentModerationSummary } from './types/comment-moderation-summary.type';

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

  @Patch(':id/hide')
  hide(@Param('id') id: string): Promise<CommentModerationSummary> {
    return this.moderationService.hideComment(id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string): Promise<CommentModerationSummary> {
    return this.moderationService.restoreComment(id);
  }
}
