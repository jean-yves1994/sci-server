import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get() @RequirePermissions('branches.read')
  @ApiOperation({ summary: 'List branches' })
  list(@CurrentUser() user: TenantContext, @Query() query: PaginationQueryDto) {
    return this.branches.list(user, query);
  }

  @Get(':id') @RequirePermissions('branches.read')
  @ApiOperation({ summary: 'Get one branch' })
  findOne(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.findOne(user, id);
  }

  @Post() @RequirePermissions('branches.write')
  @ApiOperation({ summary: 'Create a branch' })
  create(
    @CurrentUser() user: TenantContext, @Body() dto: CreateBranchDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.branches.create(user, dto, meta);
  }

  @Patch(':id') @RequirePermissions('branches.write')
  @ApiOperation({ summary: 'Update a branch' })
  update(
    @CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto, @ClientMeta() meta: RequestMetadata,
  ) {
    return this.branches.update(user, id, dto, meta);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions('branches.write')
  @ApiOperation({ summary: 'Deactivate a branch' })
  remove(
    @CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.branches.remove(user, id, meta);
  }
}
