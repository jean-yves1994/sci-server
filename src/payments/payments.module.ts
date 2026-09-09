import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaypackWebhookController } from './paypack-webhook.controller';
import { PaypackService } from './paypack.service';

@Module({
  imports: [AuditModule],
  controllers: [PaymentsController, PaypackWebhookController],
  providers: [PaypackService, PaymentsService],
  // Exported so InspectionsService can read fee status for the START gate.
  exports: [PaymentsService],
})
export class PaymentsModule {}
