import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean() @IsOptional()
  unreadOnly?: boolean;
}

export class MarkReadDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true })
  ids: string[];
}
