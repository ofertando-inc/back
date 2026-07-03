import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

// Direct onboarding: creates an already-APPROVED affiliation between a
// business account and a merchant.
export class CreateClaimDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  merchantId: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
