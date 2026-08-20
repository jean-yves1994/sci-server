import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { TenantContext } from '../common/tenant-context';
import { TemplatesService } from './templates.service';

@ApiTags('Templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get() @RequirePermissions('templates.read')
  @ApiOperation({ summary: 'List inspection templates with sections and fields' })
  list(@CurrentUser() user: TenantContext) {
    return this.templates.list(user);
  }

  @Get('default') @RequirePermissions('templates.read')
  @ApiOperation({ summary: 'The active default template used for new inspections' })
  getDefault(@CurrentUser() user: TenantContext) {
    return this.templates.getDefault(user);
  }

  @Get(':id') @RequirePermissions('templates.read')
  @ApiOperation({ summary: 'Get one template' })
  findOne(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findOne(user, id);
  }
}
