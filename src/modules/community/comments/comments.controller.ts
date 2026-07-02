import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import type { PublicUser } from '../../identity/users/types/public-user.type';
import { CommentReportsService } from './comment-reports.service';
import { CommentVotesService } from './comment-votes.service';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { ReportCommentDto } from './dto/report-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { VoteCommentDto } from './dto/vote-comment.dto';
import { CommentOwnerGuard } from './guards/comment-owner.guard';
import type {
  CommentReportResponse,
  UserCommentReportResponse,
} from './types/comment-report-response.type';
import type { CommentResponse } from './types/comment-response.type';
import type { CommentVoteResponse } from './types/comment-vote-response.type';

@Controller('offers/:offerId/comments')
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly commentVotesService: CommentVotesService,
    private readonly commentReportsService: CommentReportsService,
  ) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(
    @Param('offerId') offerId: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user?: PublicUser,
  ): Promise<PaginatedResult<CommentResponse>> {
    return this.commentsService.findThread(offerId, query, user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':commentId/replies')
  listReplies(
    @Param('offerId') offerId: string,
    @Param('commentId') commentId: string,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user?: PublicUser,
  ): Promise<PaginatedResult<CommentResponse>> {
    return this.commentsService.findReplies(
      offerId,
      commentId,
      query,
      user?.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    return this.commentsService.create(user.id, offerId, dto);
  }

  @UseGuards(JwtAuthGuard, CommentOwnerGuard)
  @Patch(':commentId')
  update(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResponse> {
    return this.commentsService.update(commentId, dto);
  }

  @UseGuards(JwtAuthGuard, CommentOwnerGuard)
  @Delete(':commentId')
  remove(@Param('commentId') commentId: string): Promise<CommentResponse> {
    return this.commentsService.softDelete(commentId);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Post(':commentId/votes')
  vote(
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
    @Body() dto: VoteCommentDto,
  ): Promise<CommentVoteResponse> {
    return this.commentVotesService.cast(user.id, commentId, dto.type);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Delete(':commentId/votes')
  withdrawVote(
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<CommentVoteResponse> {
    return this.commentVotesService.withdraw(user.id, commentId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':commentId/reports')
  report(
    @Param('offerId') offerId: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
    @Body() dto: ReportCommentDto,
  ): Promise<CommentReportResponse> {
    return this.commentReportsService.create(user.id, offerId, commentId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':commentId/reports/me')
  async findMyReport(
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<UserCommentReportResponse> {
    const report = await this.commentReportsService.findUserReport(
      user.id,
      commentId,
    );
    return { reason: report?.reason ?? null };
  }
}
