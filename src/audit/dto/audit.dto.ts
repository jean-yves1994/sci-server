import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsString() @IsOptional()
  action?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  entityType?: string;

  @ApiPropertyOptional() @IsUUID() @IsOptional()
  userId?: string;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  from?: string;

  @ApiPropertyOptional() @IsDateString() @IsOptional()
  to?: string;
}
