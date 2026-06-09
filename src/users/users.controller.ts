import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CommentsService } from '../comments/comments.service';
import type { MyComment } from '../comments/types/my-comment.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CursorPaginationQueryDto } from '../common/pagination/cursor-pagination-query.dto';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import type { MyVote } from '../votes/types/my-vote.type';
import { VotesService } from '../votes/votes.service';
import type { PublicUser } from './types/public-user.type';
import type { UserStats } from './types/user-stats.type';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly commentsService: CommentsService,
    private readonly votesService: VotesService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  @Get('me/stats')
  @UseGuards(JwtAuthGuard)
  stats(@CurrentUser() user: PublicUser): Promise<UserStats> {
    return this.usersService.getStats(user.id);
  }

  @Get('me/comments')
  @UseGuards(JwtAuthGuard)
  comments(
    @CurrentUser() user: PublicUser,
    @Query() query: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<MyComment>> {
    return this.commentsService.findByUser(user.id, query);
  }

  @Get('me/votes')
  @UseGuards(JwtAuthGuard)
  votes(
    @CurrentUser() user: PublicUser,
    @Query() query: CursorPaginationQueryDto,
  ): Promise<PaginatedResult<MyVote>> {
    return this.votesService.findByUser(user.id, query);
  }
}
