import { Module } from '@nestjs/common';

import { CommentsModule } from '../../community/comments/comments.module';
import { VotesModule } from '../../community/votes/votes.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [CommentsModule, VotesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
