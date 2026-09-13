import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';

export class ApproveDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: 'Version the reviewer saw; blocks stale approvals.' })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class DecisionDto {
  @ApiProperty({ description: 'Mandatory for rejection and correction requests.' })
  @IsString() @IsNotEmpty({ message: 'A written reason is required.' }) @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({ type: [String], description: 'Section codes needing attention.' })
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @IsOptional()
  targetSections?: string[];

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class CommentDto {
  @ApiProperty() @IsString() @IsNotEmpty({ message: 'A comment cannot be empty.' }) @MaxLength(2000)
  body: string;
}

export class ReviewerAdjustmentDto {
  @ApiProperty({ description: 'Stable field code or REVIEWED_VALUATION.' })
  @IsString() @IsNotEmpty() @MaxLength(150)
  fieldCode: string;

  @ApiProperty({ description: 'Value selected by the reviewer.' })
  @IsObject()
  adjustedValue: Record<string, unknown>;

  @ApiProperty({ description: 'Professional reason for changing the submitted value.' })
  @IsString() @IsNotEmpty() @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class ReviewerRiskDto {
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] })
  @IsString() @IsNotEmpty()
  level: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(4000)
  comments?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class ReviewerConclusionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(8000)
  conclusion: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}
