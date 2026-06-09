import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from './types/public-user.type';
import type { UserStats } from './types/user-stats.type';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
