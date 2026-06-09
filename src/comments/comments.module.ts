import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CommentReportsService } from './comment-reports.service';
import { CommentVotesService } from './comment-votes.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnerGuard } from './guards/comment-owner.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CommentsController],
  providers: [
    CommentsService,
    CommentVotesService,
    CommentReportsService,
    CommentOwnerGuard,
  ],
  exports: [CommentsService, CommentVotesService, CommentReportsService],
})
export class CommentsModule {}
