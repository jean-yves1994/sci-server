import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { SaveOwnerDto, SaveValuesDto } from '../inspections/dto/inspection.dto';
import { AdminInspectionEditService } from './admin-inspection-edit.service';

@ApiTags('Inspections')
@ApiBearerAuth()
@Controller('inspections')
export class AdminInspectionEditController {
  constructor(private readonly editor: AdminInspectionEditService) {}

  @Patch(':id/admin-edit/values')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Administrator-only correction of inspection field values' })
  saveValues(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveValuesDto, @ClientMeta() meta: RequestMetadata) {
    return this.editor.saveValues(user, id, dto, meta);
  }

  @Patch(':id/admin-edit/owner')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Administrator-only correction of inspection owner information' })
  saveOwner(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveOwnerDto, @ClientMeta() meta: RequestMetadata) {
    return this.editor.saveOwner(user, id, dto, meta);
  }
}
