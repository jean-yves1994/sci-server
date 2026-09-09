import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { RequestFeeDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Inspection fees')
@ApiBearerAuth()
@Controller('inspections')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id/payment')
  @RequirePermissions('inspections.read')
  @ApiOperation({
    summary: 'Current inspection fee status; 404 when no fee has been requested',
  })
  find(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payments.findByInspection(user, id);
  }

  @Post(':id/payment')
  @RequirePermissions('inspections.write')
  @ApiOperation({
    summary: "Send a payment prompt to the owner's mobile money number",
  })
  request(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestFeeDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.payments.request(user, id, dto, meta);
  }

  @Post(':id/payment/retry')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Send a fresh payment prompt after a failure' })
  retry(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestFeeDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.payments.retry(user, id, dto, meta);
  }
}
