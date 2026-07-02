import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { ReputationModule } from './reputation/reputation.module';
import { RootModule } from './root/root.module';
import { UsersModule } from './users/users.module';

// Identity domain: who the user is (accounts, sessions, reputation, the ROOT
// back-office and the business space).
@Module({
  imports: [
    AuthModule,
    UsersModule,
    ReputationModule,
    RootModule,
    BusinessModule,
  ],
  exports: [
    AuthModule,
    UsersModule,
    ReputationModule,
    RootModule,
    BusinessModule,
  ],
})
export class IdentityModule {}
