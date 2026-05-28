import { ReportReason } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../common/transformers/trim.transformer';

export class CreateReportDto {
  @IsEnum(ReportReason)
  reason: ReportReason;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
