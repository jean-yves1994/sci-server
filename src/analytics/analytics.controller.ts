import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { TenantContext } from '../common/tenant-context';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Headline figures, computed from real queries' })
  dashboard(@CurrentUser() user: TenantContext) {
    return this.analytics.dashboard(user);
  }

  @Get('monthly')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Inspection volume by month' })
  monthly(@CurrentUser() user: TenantContext, @Query('months') months?: string) {
    const parsed = Number(months);
    return this.analytics.monthly(user, Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 36) : 12);
  }

  @Get('by-branch')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Volume and approval rate per branch' })
  byBranch(@CurrentUser() user: TenantContext) {
    return this.analytics.byBranch(user);
  }

  @Get('by-inspector')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Inspector workload: volume and open items' })
  byInspector(@CurrentUser() user: TenantContext) {
    return this.analytics.byInspector(user);
  }
}
