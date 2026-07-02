import { Module } from '@nestjs/common';

import { ModerationLogModule } from '../../moderation/moderation-log.module';
import { AccountsController } from './accounts.controller';
import { ClaimsController } from './claims.controller';
import { RootAccountsService } from './root-accounts.service';
import { RootClaimsService } from './root-claims.service';

// ROOT back-office: account management and affiliation decisions.
@Module({
  imports: [ModerationLogModule],
  controllers: [AccountsController, ClaimsController],
  providers: [RootAccountsService, RootClaimsService],
})
export class RootModule {}
