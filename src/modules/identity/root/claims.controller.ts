import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RootGuard } from '../../../common/guards/root.guard';
import type { PaginatedResult } from '../../../common/pagination/paginated-result.type';
import { ModerationDecisionDto } from '../../moderation/dto/moderation-decision.dto';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ListClaimsQueryDto } from './dto/list-claims-query.dto';
import { RootClaimsService } from './root-claims.service';
import type { ClaimResponse } from './types/claim-response.type';

@UseGuards(JwtAuthGuard, RootGuard)
@Controller('admin/claims')
export class ClaimsController {
  constructor(private readonly rootClaimsService: RootClaimsService) {}

  @Get()
  list(
    @Query() query: ListClaimsQueryDto,
  ): Promise<PaginatedResult<ClaimResponse>> {
    return this.rootClaimsService.list(query);
  }

  // Direct onboarding: create + approve in one call.
  @Post()
  create(
    @CurrentUser() root: PublicUser,
    @Body() dto: CreateClaimDto,
  ): Promise<ClaimResponse> {
    return this.rootClaimsService.createApproved(root.id, dto);
  }

  @Patch(':id/approve')
  approve(
    @CurrentUser() root: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<ClaimResponse> {
    return this.rootClaimsService.approve(root.id, id, decision);
  }

  @Patch(':id/reject')
  reject(
    @CurrentUser() root: PublicUser,
    @Param('id') id: string,
    @Body() decision: ModerationDecisionDto,
  ): Promise<ClaimResponse> {
    return this.rootClaimsService.reject(root.id, id, decision);
  }
}
