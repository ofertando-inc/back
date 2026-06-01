import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CommentVotesService } from './comment-votes.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnerGuard } from './guards/comment-owner.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentVotesService, CommentOwnerGuard],
  exports: [CommentsService, CommentVotesService],
})
export class CommentsModule {}
