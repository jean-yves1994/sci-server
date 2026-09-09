import {
  Controller,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { PaypackService, PaypackWebhookEvent } from './paypack.service';

/**
 * Paypack delivery endpoint.
 *
 * Public because an HTTP callback cannot carry a bearer token — the signature
 * IS the authentication. Everything therefore depends on
 * `verifySignature` being correct.
 */
@ApiExcludeController()
@Controller('webhooks/paypack')
export class PaypackWebhookController {
  private readonly logger = new Logger(PaypackWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly paypack: PaypackService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>) {
    const rawBody = req.rawBody;

    if (!rawBody) {
      // Means `rawBody: true` is missing from NestFactory.create — a
      // re-serialised body can never produce a matching digest.
      this.logger.error('Raw body unavailable; cannot verify webhook signature.');
      throw new UnauthorizedException('Signature could not be verified.');
    }

    const signature = req.headers[PaypackService.SIGNATURE_HEADER] as
      | string
      | undefined;

    if (!this.paypack.verifySignature(rawBody, signature)) {
      this.logger.warn('Rejected a Paypack webhook with an invalid signature.');
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    let event: PaypackWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as PaypackWebhookEvent;
    } catch {
      this.logger.warn('Paypack webhook body was not valid JSON.');
      // Still 200: a malformed body will not become well-formed on retry.
      return { received: true };
    }

    // Paypack fires this event whether the transaction succeeded or failed.
    if (event.kind && event.kind !== 'transaction:processed') {
      return { received: true };
    }

    try {
      await this.payments.applyWebhook(event);
    } catch (error) {
      this.logger.error(
        `Failed to apply Paypack webhook: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Deliberately still 200. Reconciliation on GET /payment will recover
      // the state, whereas a non-2xx makes Paypack retry indefinitely.
    }

    return { received: true };
  }
}
