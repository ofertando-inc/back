import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateVoteDto } from './dto/create-vote.dto';
import type { UserVoteResponse } from './types/user-vote-response.type';
import type { VoteResponse } from './types/vote-response.type';
import { VotesService } from './votes.service';

@UseGuards(JwtAuthGuard)
@Controller('offers/:offerId/votes')
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  cast(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateVoteDto,
  ): Promise<VoteResponse> {
    return this.votesService.cast(user.id, offerId, dto.type);
  }

  @HttpCode(HttpStatus.OK)
  @Delete()
  withdraw(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<VoteResponse> {
    return this.votesService.withdraw(user.id, offerId);
  }

  @Get('me')
  async findMine(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<UserVoteResponse> {
    const vote = await this.votesService.findUserVote(user.id, offerId);
    return { type: vote?.type ?? null };
  }
}
