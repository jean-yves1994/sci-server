import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Kigali Commercial Building' })
  @IsString() @IsNotEmpty() @MaxLength(150) name: string;

  @ApiProperty({ example: 'Commercial', enum: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Land', 'Other'] })
  @IsString() @IsNotEmpty() @MaxLength(30) propertyType: string;

  @ApiProperty({ example: 'John Doe', description: 'Owner / client name. Used to generate the property reference.' })
  @IsString() @IsNotEmpty() @MaxLength(150) ownerClientName: string;

  @ApiProperty({ description: 'Unique Parcel Identifier (UPI). This is the only land identifier required at property registration.', example: '1/03/07/04/1234' })
  @IsString() @IsNotEmpty() @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  titleNumber: string;

  @ApiProperty({ example: 'Kigali' })
  @IsString() @IsNotEmpty() @MaxLength(100) province: string;
  @ApiProperty({ example: 'Gasabo' })
  @IsString() @IsNotEmpty() @MaxLength(100) district: string;
  @ApiProperty({ example: 'Kimironko' })
  @IsString() @IsNotEmpty() @MaxLength(100) sector: string;
  @ApiProperty({ example: 'Nyagatovu' })
  @IsString() @IsNotEmpty() @MaxLength(100) cell: string;
  @ApiPropertyOptional({ example: 'KG 11 Ave' })
  @IsString() @IsOptional() @MaxLength(150) villageStreet?: string;
  @ApiPropertyOptional({ example: 'uuid-of-branch' })
  @IsString() @IsOptional() branchId?: string;
}

export class UpdatePropertyDto {
  @ApiPropertyOptional({ example: 'Kigali Commercial Building' })
  @IsString() @IsOptional() @MaxLength(150) name?: string;
  @ApiPropertyOptional({ enum: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Land', 'Other'] })
  @IsString() @IsOptional() @MaxLength(30) propertyType?: string;
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString() @IsOptional() @MaxLength(150) ownerClientName?: string;
  @ApiPropertyOptional({ description: 'Unique Parcel Identifier (UPI).' })
  @IsString() @IsOptional() @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  titleNumber?: string;
  @ApiPropertyOptional({ example: 'Kigali' }) @IsString() @IsOptional() @MaxLength(100) province?: string;
  @ApiPropertyOptional({ example: 'Gasabo' }) @IsString() @IsOptional() @MaxLength(100) district?: string;
  @ApiPropertyOptional({ example: 'Kimironko' }) @IsString() @IsOptional() @MaxLength(100) sector?: string;
  @ApiPropertyOptional({ example: 'Nyagatovu' }) @IsString() @IsOptional() @MaxLength(100) cell?: string;
  @ApiPropertyOptional({ example: 'KG 11 Ave' }) @IsString() @IsOptional() @MaxLength(150) villageStreet?: string;
}
