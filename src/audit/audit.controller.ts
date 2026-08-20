import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { TenantContext } from '../common/tenant-context';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'The audit trail, filterable by action, entity, user and date' })
  list(@CurrentUser() user: TenantContext, @Query() query: AuditQueryDto) {
    return this.audit.list(user, {
      page: query.page,
      pageSize: query.pageSize,
      action: query.action,
      entityType: query.entityType,
      userId: query.userId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
