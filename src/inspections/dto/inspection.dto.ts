import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ConditionStatus, InspectionStatus, LocationSource, OccupancyStatus, OwnershipType, Priority,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsLatitude,
  IsLongitude, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max,
  MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateInspectionDto {
  @ApiProperty() @IsUUID()
  propertyId: string;

  @ApiProperty({ example: 'LOAN-2026-001' })
  @IsString() @IsNotEmpty() @MaxLength(60)
  loanReference: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(160)
  clientName?: string;

  @ApiPropertyOptional({ description: 'Defaults to the organization default template.' })
  @IsUUID() @IsOptional()
  templateId?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  inspectorId?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  reviewerId?: string;

  @ApiPropertyOptional({ enum: Priority }) @IsEnum(Priority) @IsOptional()
  priority?: Priority;

  @ApiPropertyOptional({ example: '2026-09-30' }) @IsDateString() @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000)
  notes?: string;
}

export class AssignInspectionDto {
  @ApiProperty() @IsUUID()
  inspectorId: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  reviewerId?: string;

  @ApiPropertyOptional({ enum: Priority }) @IsEnum(Priority) @IsOptional()
  priority?: Priority;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Mandatory when reassigning away from another inspector.' })
  @IsString() @IsOptional() @MaxLength(1000)
  reason?: string;
}

export class InspectionValueDto {
  @ApiProperty() @IsUUID()
  fieldId: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(4000)
  valueText?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional()
  valueNumber?: number;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  valueDate?: string;

  @ApiPropertyOptional() @IsBoolean() @IsOptional()
  valueBool?: boolean;

  @ApiPropertyOptional() @IsOptional()
  valueJson?: unknown;
}

export class SaveValuesDto {
  @ApiProperty({ type: [InspectionValueDto] })
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => InspectionValueDto)
  values: InspectionValueDto[];

  @ApiPropertyOptional({ description: 'Version last seen; enables conflict detection.' })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class SaveAssessmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60)
  categoryCode: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120)
  categoryName?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @Type(() => Number) @IsInt() @Min(1) @Max(5) @IsOptional()
  rating?: number;

  @ApiPropertyOptional({ enum: ConditionStatus })
  @IsEnum(ConditionStatus) @IsOptional()
  condition?: ConditionStatus;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class SaveOwnerDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(160)
  fullName: string;

  @ApiPropertyOptional({ description: 'Encrypted at rest before storage.' })
  @IsString() @IsOptional() @MaxLength(40)
  nationalId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ enum: OccupancyStatus })
  @IsEnum(OccupancyStatus) @IsOptional()
  occupancyStatus?: OccupancyStatus;

  @ApiPropertyOptional({ enum: OwnershipType })
  @IsEnum(OwnershipType) @IsOptional()
  ownershipType?: OwnershipType;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class SaveValuationDto {
  @ApiPropertyOptional({ default: 'RWF' }) @IsString() @IsOptional() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  marketValue?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  forcedSaleValue?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  replacementCost?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  rentalEstimate?: number;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(4000)
  comments?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class CaptureLocationDto {
  @ApiProperty() @Type(() => Number) @IsLatitude()
  latitude: number;

  @ApiProperty() @Type(() => Number) @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ description: 'Device-reported accuracy in metres.' })
  @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  accuracyM?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @IsOptional()
  altitudeM?: number;

  @ApiPropertyOptional({ enum: LocationSource }) @IsEnum(LocationSource) @IsOptional()
  source?: LocationSource;

  @ApiPropertyOptional({ description: 'Android isFromMockProvider. Recorded, not enforced.' })
  @IsBoolean() @IsOptional()
  isMocked?: boolean;

  @ApiProperty() @IsDateString()
  capturedAt: string;

  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  baseVersion?: number;
}

export class InspectionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InspectionStatus, isArray: true })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    return undefined;
  })
  @IsArray() @IsEnum(InspectionStatus, { each: true }) @IsOptional()
  status?: InspectionStatus[];

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  branchId?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  inspectorId?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  reviewerId?: string;

  @ApiPropertyOptional({ enum: Priority }) @IsEnum(Priority) @IsOptional()
  priority?: Priority;

  @ApiPropertyOptional() @IsString() @IsOptional()
  propertyType?: string;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  from?: string;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Limit to inspections assigned to the caller.' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean() @IsOptional()
  assignedToMe?: boolean;

  @ApiPropertyOptional({
    enum: ['createdAt', 'submittedAt', 'dueDate', 'priority', 'status', 'inspectionNumber'],
  })
  @IsIn(['createdAt', 'submittedAt', 'dueDate', 'priority', 'status', 'inspectionNumber'])
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc']) @IsOptional()
  sortDir?: 'asc' | 'desc';
}
