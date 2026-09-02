import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePropertyDto {
  @ApiPropertyOptional({
    example: 'PROP-2026-0001',
    description: 'Optional property reference. If omitted, the backend generates one.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  reference?: string;

  @ApiProperty({ example: 'Kigali Commercial Building' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({
    example: 'Commercial',
    enum: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Land', 'Other'],
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  propertyType: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  ownerClientName: string;

  @ApiProperty({ example: 'Kigali' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province: string;

  @ApiProperty({ example: 'Gasabo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  district: string;

  @ApiProperty({ example: 'Kimironko' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sector: string;

  @ApiProperty({ example: 'Nyagatovu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cell: string;

  @ApiPropertyOptional({ example: 'KG 11 Ave' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  villageStreet?: string;

  @ApiPropertyOptional({
    example: 'uuid-of-branch',
    description: 'Branch owning the property record. The authenticated user must have access to it.',
  })
  @IsString()
  @IsOptional()
  branchId?: string;
}

export class UpdatePropertyDto {
  @ApiPropertyOptional({ example: 'Kigali Commercial Building' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: 'Commercial',
    enum: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Land', 'Other'],
  })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  propertyType?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  ownerClientName?: string;

  @ApiPropertyOptional({ example: 'Kigali' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  province?: string;

  @ApiPropertyOptional({ example: 'Gasabo' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'Kimironko' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({ example: 'Nyagatovu' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  cell?: string;

  @ApiPropertyOptional({ example: 'KG 11 Ave' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  villageStreet?: string;
}
