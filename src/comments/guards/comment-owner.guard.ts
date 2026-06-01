import { Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { ErrorKey } from '../../common/exceptions/error-keys';
import { OwnerGuard } from '../../common/guards/owner.guard';
import { CommentsService } from '../comments.service';

@Injectable()
export class CommentOwnerGuard extends OwnerGuard {
  protected readonly notFoundKey = ErrorKey.CommentNotFound;
  protected readonly forbiddenKey = ErrorKey.CommentForbidden;

  constructor(private readonly commentsService: CommentsService) {
    super();
  }

  protected async resolveOwnerId(
    req: AuthenticatedRequest,
  ): Promise<string | null> {
    const id = req.params.commentId;
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    const comment = await this.commentsService.findRawById(id);
    if (!comment || comment.deletedAt) {
      return null;
    }
    return comment.userId;
  }
}
