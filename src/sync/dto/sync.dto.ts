import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Min, ValidateNested,
} from 'class-validator';

export const SYNC_OPERATION_TYPES = [
  'UPSERT_VALUES', 'UPSERT_ASSESSMENT', 'UPSERT_OWNER', 'UPSERT_VALUATION', 'ADD_LOCATION',
] as const;

export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

export class SyncOperationDto {
  @ApiProperty({ description: 'Client-generated id; makes replay idempotent.' })
  @IsString()
  clientOperationId: string;

  @ApiProperty() @IsUUID()
  inspectionId: string;

  @ApiProperty({ enum: SYNC_OPERATION_TYPES })
  @IsIn(SYNC_OPERATION_TYPES)
  type: SyncOperationType;

  @ApiPropertyOptional({ description: 'Version the device last saw.' })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;

  @ApiProperty({ description: 'Operation-specific body.' })
  @IsObject()
  payload: Record<string, unknown>;
}

export class SyncPushDto {
  @ApiProperty({ type: [SyncOperationDto] })
  @IsArray()
  // Bounded, so one device cannot occupy a worker with an unbounded batch.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}

export class SyncPullQueryDto {
  @ApiPropertyOptional({ description: 'ISO timestamp of the last successful pull.' })
  @IsDateString() @IsOptional()
  since?: string;
}
