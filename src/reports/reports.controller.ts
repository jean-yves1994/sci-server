import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'List generated reports' })
  list(@CurrentUser() user: TenantContext, @Query() query: PaginationQueryDto) {
    return this.reports.list(user, query);
  }

  @Post('inspections/:id/report')
  @RequirePermissions('reports.generate')
  @ApiOperation({ summary: 'Generate (or regenerate as a new version) the official PDF' })
  generate(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reports.generate(user, id, meta);
  }

  @Get('reports/:reportId/download')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Signed download URL. Access is checked and audited.' })
  download(
    @CurrentUser() user: TenantContext,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @ClientMeta() meta: RequestMetadata,
    @Query('disposition') disposition?: 'inline' | 'attachment',
  ) {
    return this.reports.getDownloadUrl(
      user, reportId, meta, disposition === 'inline' ? 'inline' : 'attachment',
    );
  }
}
