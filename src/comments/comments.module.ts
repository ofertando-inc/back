import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { CommentLikesService } from './comment-likes.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnerGuard } from './guards/comment-owner.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentLikesService, CommentOwnerGuard],
  exports: [CommentsService, CommentLikesService],
})
export class CommentsModule {}
