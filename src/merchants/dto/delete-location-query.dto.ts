import { IsOptional, IsUUID } from 'class-validator';

export class DeleteLocationQueryDto {
  // When the location still has offers, move them to this location (same
  // merchant) before deleting; otherwise the deletion is refused.
  @IsOptional()
  @IsUUID()
  reassignTo?: string;
}
