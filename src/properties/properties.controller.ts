import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/property.dto';
import { PropertiesService } from './properties.service';

@ApiTags('Properties')
@ApiBearerAuth()
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get() @RequirePermissions('properties.read')
  @ApiOperation({ summary: 'List properties' })
  list(@CurrentUser() user: TenantContext, @Query() query: PaginationQueryDto) {
    return this.properties.list(user, query);
  }

  @Get(':id') @RequirePermissions('properties.read')
  @ApiOperation({ summary: 'Get one property with its inspection history' })
  findOne(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.findOne(user, id);
  }

  @Post() @RequirePermissions('properties.write')
  @ApiOperation({ summary: 'Register a property' })
  create(
    @CurrentUser() user: TenantContext, @Body() dto: CreatePropertyDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.properties.create(user, dto, meta);
  }

  @Patch(':id') @RequirePermissions('properties.write')
  @ApiOperation({ summary: 'Update a property' })
  update(
    @CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto, @ClientMeta() meta: RequestMetadata,
  ) {
    return this.properties.update(user, id, dto, meta);
  }
}
