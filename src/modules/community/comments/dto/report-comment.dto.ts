import { CommentReportReason } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { trim } from '../../../../common/transformers/trim.transformer';

export class ReportCommentDto {
  @IsEnum(CommentReportReason)
  reason: CommentReportReason;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
