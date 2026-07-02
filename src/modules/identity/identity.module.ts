import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { ReputationModule } from './reputation/reputation.module';
import { UsersModule } from './users/users.module';

// Identity domain: who the user is (accounts, sessions, reputation).
@Module({
  imports: [AuthModule, UsersModule, ReputationModule],
  exports: [AuthModule, UsersModule, ReputationModule],
})
export class IdentityModule {}
