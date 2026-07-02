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
import type { PublicUser } from '../users/types/public-user.type';
import { CreateAccountDto } from './dto/create-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { RootAccountsService } from './root-accounts.service';

@UseGuards(JwtAuthGuard, RootGuard)
@Controller('admin/accounts')
export class AccountsController {
  constructor(private readonly rootAccountsService: RootAccountsService) {}

  @Get()
  list(
    @Query() query: ListAccountsQueryDto,
  ): Promise<PaginatedResult<PublicUser>> {
    return this.rootAccountsService.list(query);
  }

  @Post()
  create(
    @CurrentUser() root: PublicUser,
    @Body() dto: CreateAccountDto,
  ): Promise<PublicUser> {
    return this.rootAccountsService.create(root.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() root: PublicUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<PublicUser> {
    return this.rootAccountsService.update(root.id, id, dto);
  }
}
