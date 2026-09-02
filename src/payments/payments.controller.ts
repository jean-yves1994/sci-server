import {
  Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PaymentsService } from './payments.service';
import { RequestFeeDto } from './dto/fee.dto';

@ApiTags('Inspection fee')
@ApiBearerAuth()
@Controller('inspections/:id/fee')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'Current fee status for an inspection' })
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { organizationId: string },
  ) {
    return this.payments.status(id, user.organizationId);
  }

  @Post('request')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: "Push a payment prompt to the client's phone" })
  request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestFeeDto,
    @CurrentUser() user: { userId: string; organizationId: string },
  ) {
    return this.payments.request(id, dto.phoneNumber, user);
  }
}

/**
 * Webhook receiver.
 *
 * Public by necessity — Paypack has no bearer token — so authenticity rests
 * entirely on the HMAC signature. Mounted separately from the authenticated
 * routes above so the guard exemption is visible rather than buried.
 */
@ApiTags('Inspection fee')
@Controller('webhooks/paypack')
export class PaypackWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-paypack-signature') signature: string,
    @Body() body: { data?: { ref?: string; status?: string } },
  ) {
    // Requires rawBody. In main.ts:
    //   NestFactory.create(AppModule, { rawBody: true })
    const raw = request.rawBody;

    if (!raw || !signature || !this.payments.verifySignature(raw, signature)) {
      // 200 regardless. Telling an unauthenticated caller that their signature
      // was wrong helps only someone probing the endpoint; Paypack does not
      // need to know either way.
      return { received: true };
    }

    const ref = body.data?.ref;
    const status = body.data?.status;

    if (ref && status) {
      await this.payments.settle(ref, status);
    }

    return { received: true };
  }
}
