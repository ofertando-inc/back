import { Module } from '@nestjs/common';

import { CommentsModule } from '../comments/comments.module';
import { VotesModule } from '../votes/votes.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [CommentsModule, VotesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
