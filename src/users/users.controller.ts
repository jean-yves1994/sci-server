import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { CreateUserDto, ResetUserPasswordDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'List users' })
  list(@CurrentUser() user: TenantContext, @Query() query: UserQueryDto) {
    return this.usersService.list(user, query);
  }

  @Get('inspectors')
  @RequirePermissions('inspections.assign')
  @ApiOperation({ summary: 'Inspectors available for assignment, with current workload' })
  inspectors(@CurrentUser() user: TenantContext, @Query('branchId') branchId?: string) {
    return this.usersService.listInspectors(user, branchId);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Get one user' })
  findOne(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(user, id);
  }

  @Post()
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Create a user' })
  create(
    @CurrentUser() user: TenantContext,
    @Body() dto: CreateUserDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.usersService.create(user, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Update a user, including roles and status' })
  update(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.usersService.update(user, id, dto, meta);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.reset_password')
  @ApiOperation({ summary: 'Set a new password and force a change at next sign-in' })
  resetPassword(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetUserPasswordDto,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.usersService.resetPassword(user, id, dto, meta);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.write')
  @ApiOperation({ summary: 'Clear a lockout caused by failed sign-ins' })
  unlock(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.usersService.unlock(user, id, meta);
  }
}
