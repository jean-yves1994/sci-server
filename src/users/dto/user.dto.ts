import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import {
  ArrayMinSize, IsArray, IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional,
  IsString, IsUUID, MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty() @IsEmail()
  email: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60)
  firstName: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60)
  lastName: string;

  @ApiProperty({ description: 'Temporary; the user must change it at first sign-in.' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(40)
  employeeNumber?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['OWN_BRANCH', 'ALL_BRANCHES'], default: 'OWN_BRANCH' })
  @IsIn(['OWN_BRANCH', 'ALL_BRANCHES']) @IsOptional()
  branchScope?: 'OWN_BRANCH' | 'ALL_BRANCHES';

  @ApiProperty({ type: [String], example: ['INSPECTOR'] })
  @IsArray() @ArrayMinSize(1, { message: 'Assign at least one role.' }) @IsString({ each: true })
  roleCodes: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60)
  lastName?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(40)
  employeeNumber?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['OWN_BRANCH', 'ALL_BRANCHES'] })
  @IsIn(['OWN_BRANCH', 'ALL_BRANCHES']) @IsOptional()
  branchScope?: 'OWN_BRANCH' | 'ALL_BRANCHES';

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus) @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the entire set of roles.' })
  @IsArray() @IsString({ each: true }) @IsOptional()
  roleCodes?: string[];
}

export class ResetUserPasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200)
  newPassword: string;
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsUUID() @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus) @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional() @IsString() @IsOptional()
  roleCode?: string;
}
