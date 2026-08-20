import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength,
} from 'class-validator';

export class CreatePropertyDto {
  @ApiProperty({ example: 'PROP-2026-0001' })
  @IsString() @IsNotEmpty() @MaxLength(40)
  reference: string;

  @ApiProperty() @IsUUID()
  branchId: string;

  @ApiProperty({ example: 'Residential house' })
  @IsString() @IsNotEmpty() @MaxLength(60)
  propertyType: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250)
  addressLine: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  divisionId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  plotNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  titleNumber?: string;

  @ApiPropertyOptional({ description: 'Registered position, used for proof-of-presence.' })
  @Type(() => Number) @IsLatitude() @IsOptional()
  latitude?: number;

  @ApiPropertyOptional()
  @Type(() => Number) @IsLongitude() @IsOptional()
  longitude?: number;
}

export class UpdatePropertyDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  propertyType?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(250)
  addressLine?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  divisionId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  plotNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  titleNumber?: string;

  @ApiPropertyOptional() @Type(() => Number) @IsLatitude() @IsOptional()
  latitude?: number;

  @ApiPropertyOptional() @Type(() => Number) @IsLongitude() @IsOptional()
  longitude?: number;
}
