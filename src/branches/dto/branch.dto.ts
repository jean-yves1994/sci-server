import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecordStatus } from '@prisma/client';
import {
  IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'KGL-001' })
  @IsString() @IsNotEmpty() @MaxLength(20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'Branch code may contain letters, digits and hyphens only.' })
  code: string;

  @ApiProperty({ example: 'Kigali Main Branch' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  divisionId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional() @IsEmail() @IsOptional()
  email?: string;
}

export class UpdateBranchDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200)
  addressLine?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  divisionId?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional() @IsEmail() @IsOptional()
  email?: string;

  @ApiPropertyOptional({ enum: RecordStatus })
  @IsEnum(RecordStatus) @IsOptional()
  status?: RecordStatus;
}
