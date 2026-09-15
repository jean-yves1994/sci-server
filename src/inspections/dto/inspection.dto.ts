import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ConditionStatus, OccupancyStatus, OwnershipType } from '@prisma/client';

export class InspectionValueDto {
  @ApiProperty() @IsString() fieldId: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(4000) valueText?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional() valueNumber?: number;
  @ApiPropertyOptional() @IsDateString() @IsOptional() valueDate?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() valueBool?: boolean;
  @ApiPropertyOptional() @IsOptional() valueJson?: unknown;
}

export class SaveValuesDto {
  @ApiProperty({ type: [InspectionValueDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => InspectionValueDto) values: InspectionValueDto[];
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional() baseVersion?: number;
}

export class SaveAssessmentDto {
  @ApiProperty() @IsString() @MaxLength(60) categoryCode: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) categoryName?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) @IsOptional() rating?: number;
  @ApiPropertyOptional({ enum: ConditionStatus }) @IsEnum(ConditionStatus) @IsOptional() condition?: ConditionStatus;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional() baseVersion?: number;
}

export class SaveOwnerDto {
  @ApiProperty() @IsString() @MaxLength(160) fullName: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(40) nationalId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsEmail() @IsOptional() @MaxLength(160) email?: string;
  @ApiPropertyOptional({ enum: OccupancyStatus }) @IsEnum(OccupancyStatus) @IsOptional() occupancyStatus?: OccupancyStatus;
  @ApiPropertyOptional({ enum: OwnershipType }) @IsEnum(OwnershipType) @IsOptional() ownershipType?: OwnershipType;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional() baseVersion?: number;
}

export class SaveValuationDto {
  @ApiPropertyOptional({ default: 'RWF' }) @IsString() @IsOptional() @MaxLength(3) currency?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional() marketValue?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional() forcedSaleValue?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional() replacementCost?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional() rentalEstimate?: number;
  @ApiPropertyOptional({ description: 'Current professional land value.' }) @Type(() => Number) @IsNumber() @Min(0) @IsOptional() landValue?: number;
  @ApiPropertyOptional({ description: 'Current professional main building value.' }) @Type(() => Number) @IsNumber() @Min(0) @IsOptional() mainBuildingValue?: number;
  @ApiPropertyOptional({ description: 'Current professional total estimated value.' }) @Type(() => Number) @IsNumber() @Min(0) @IsOptional() totalEstimatedValue?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(4000) comments?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional() baseVersion?: number;
}

export class CaptureLocationDto {
  @ApiProperty() @Type(() => Number) @IsLatitude() latitude: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() longitude: number;
  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional() accuracyM?: number;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isMocked?: boolean;
  @ApiPropertyOptional() @IsString() @IsOptional() source?: string;
}
