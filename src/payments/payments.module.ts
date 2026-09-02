import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController, PaypackWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaypackClient } from './paypack.client';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentsController, PaypackWebhookController],
  providers: [PaymentsService, PaypackClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}
