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

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import type { PublicUser } from '../users/types/public-user.type';
import { CommentLikesService } from './comment-likes.service';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentOwnerGuard } from './guards/comment-owner.guard';
import type { CommentResponse } from './types/comment-response.type';
import type { LikeResponse } from './types/like-response.type';

@Controller('offers/:offerId/comments')
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly commentLikesService: CommentLikesService,
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
  @Post(':commentId/likes')
  like(
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<LikeResponse> {
    return this.commentLikesService.like(user.id, commentId);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Delete(':commentId/likes')
  unlike(
    @Param('commentId') commentId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<LikeResponse> {
    return this.commentLikesService.unlike(user.id, commentId);
  }
}
