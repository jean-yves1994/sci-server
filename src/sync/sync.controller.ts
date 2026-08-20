import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { SyncPullQueryDto, SyncPushDto } from './dto/sync.dto';
import { SyncService } from './sync.service';

@ApiTags('Synchronisation')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Delta download of assigned work for offline use' })
  pull(@CurrentUser() user: TenantContext, @Query() query: SyncPullQueryDto) {
    return this.sync.pull(user, query);
  }

  @Post('push')
  @RequirePermissions('inspections.write')
  @ApiOperation({
    summary: 'Upload queued offline changes',
    description:
      'Idempotent and conflict-aware. Each operation returns APPLIED, DUPLICATE, CONFLICT or REJECTED independently.',
  })
  push(
    @CurrentUser() user: TenantContext,
    @Body() dto: SyncPushDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.sync.push(user, dto, meta);
  }
}
