import { Module } from '@nestjs/common';

import { CommentsModule } from './comments/comments.module';
import { ReportsModule } from './reports/reports.module';
import { VotesModule } from './votes/votes.module';

// Community domain: how users interact with the catalog (votes, reports,
// comments).
@Module({
  imports: [VotesModule, ReportsModule, CommentsModule],
  exports: [VotesModule, ReportsModule, CommentsModule],
})
export class CommunityModule {}
