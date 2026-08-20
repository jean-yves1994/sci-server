import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PhotoCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min,
} from 'class-validator';

export class UploadPhotoDto {
  @ApiPropertyOptional({ enum: PhotoCategory })
  @IsEnum(PhotoCategory) @IsOptional()
  category?: PhotoCategory;

  @ApiPropertyOptional({ description: 'Links the photo to an assessment category.' })
  @IsUUID() @IsOptional()
  assessmentId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300)
  caption?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsLatitude() @IsOptional()
  latitude?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsLongitude() @IsOptional()
  longitude?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsNumber() @Min(0) @IsOptional()
  accuracyM?: number;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  capturedAt?: string;

  @ApiPropertyOptional({ description: 'Client id; makes a retried upload idempotent.' })
  @IsString() @IsOptional() @MaxLength(120)
  clientRequestId?: string;
}
