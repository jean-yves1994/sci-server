import { Injectable, Logger } from '@nestjs/common';
import { FeeStatus, InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { RequestFeeDto } from './dto/payment.dto';
import { PaypackService, PaypackWebhookEvent } from './paypack.service';

/** RWF has no minor unit, so the fee is a whole number. */
const INSPECTION_FEE_RWF = Number(process.env.INSPECTION_FEE_RWF ?? 15000);

/**
 * A fee left PROCESSING beyond this is assumed lost — the USSD prompt itself
 * expires well before it. Marking it FAILED gives the inspector a retry
 * instead of an indefinite spinner.
 */
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

/** How stale a PROCESSING record must be before we ask Paypack directly. */
const RECONCILE_AFTER_MS = 20 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypack: PaypackService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------- reading

  /**
   * Current fee state, reconciling first if the record looks stranded.
   *
   * The Flutter app polls this every 3 seconds while waiting, which makes it
   * the natural place to recover from a lost webhook — Vercel's serverless
   * runtime has no long-running process for a cron job.
   */
  async findByInspection(user: TenantContext, inspectionId: string) {
    const inspection = await this.loadInspection(user, inspectionId);

    const fee = await this.prisma.inspectionFee.findUnique({
      where: { inspectionId: inspection.id },
    });

    if (!fee) {
      throw new NotFoundError(
        ErrorCode.NOT_FOUND,
        'No inspection fee has been requested yet.',
      );
    }

    return this.reconcileIfStale(fee, user, inspectionId);
  }

  // ------------------------------------------------------------ requesting

  /**
   * Sends a payment prompt to the owner's handset.
   *
   * Idempotent by design: an already-settled fee returns unchanged, and one
   * already awaiting approval is not pushed twice — an inspector tapping
   * twice must not charge the owner twice.
   */
  async request(
    user: TenantContext,
    inspectionId: string,
    dto: RequestFeeDto,
    meta: RequestMetadata,
    options: { isRetry?: boolean } = {},
  ) {
    const inspection = await this.loadInspection(user, inspectionId);

    if (inspection.inspectorId !== user.userId) {
      throw new ForbiddenError(
        'Only the assigned inspector can request the inspection fee.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    if (inspection.status !== InspectionStatus.ASSIGNED) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INVALID_TRANSITION,
        'The fee applies only to an inspection that has not yet started.',
      );
    }

    const existing = await this.prisma.inspectionFee.findUnique({
      where: { inspectionId },
    });

    if (existing?.status === FeeStatus.SUCCESSFUL) {
      return existing; // already paid; nothing to do
    }

    if (existing?.status === FeeStatus.PROCESSING && !options.isRetry) {
      // A prompt is already on the owner's phone. Re-sending would push a
      // second charge.
      return existing;
    }

    const phoneNumber = this.normalisePhone(dto.phoneNumber);
    const idempotencyKey = PaypackService.newIdempotencyKey();

    // Persist BEFORE calling Paypack, so a webhook arriving immediately has a
    // row to attach to.
    const fee = await this.prisma.inspectionFee.upsert({
      where: { inspectionId },
      create: {
        inspectionId,
        amount: INSPECTION_FEE_RWF,
        currency: 'RWF',
        phoneNumber,
        status: FeeStatus.PENDING,
        idempotencyKey,
        requestedById: user.userId,
      },
      update: {
        phoneNumber,
        status: FeeStatus.PENDING,
        idempotencyKey,
        providerRef: null,
        failureReason: null,
        requestedById: user.userId,
        requestedAt: new Date(),
      },
    });

    try {
      const tx = await this.paypack.cashin({
        amount: fee.amount,
        phoneNumber,
        idempotencyKey,
      });

      const updated = await this.prisma.inspectionFee.update({
        where: { id: fee.id },
        data: {
          providerRef: tx.ref,
          // PROCESSING, never SUCCESSFUL: Paypack always returns `pending`
          // here, and treating that as confirmation would unlock an unpaid
          // inspection.
          status: FeeStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });

      await this.audit.record({
        organizationId: user.organizationId,
        userId: user.userId,
        action: options.isRetry ? 'INSPECTION_FEE_RETRIED' : 'INSPECTION_FEE_REQUESTED',
        entityType: 'InspectionFee',
        entityId: updated.id,
        newValue: {
          inspectionId,
          amount: updated.amount,
          providerRef: tx.ref,
          // Deliberately not logging the full number.
          phoneSuffix: phoneNumber.slice(-3),
        },
        meta,
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Paypack cashin failed for inspection ${inspectionId}: ${message}`);

      const failed = await this.prisma.inspectionFee.update({
        where: { id: fee.id },
        data: {
          status: FeeStatus.FAILED,
          failureReason: 'The payment request could not be sent. Please try again.',
          attempts: { increment: 1 },
        },
      });

      await this.audit.record({
        organizationId: user.organizationId,
        userId: user.userId,
        action: 'INSPECTION_FEE_REQUEST_FAILED',
        entityType: 'InspectionFee',
        entityId: failed.id,
        metadata: { inspectionId, error: message },
        meta,
      });

      return failed;
    }
  }

  retry(
    user: TenantContext,
    inspectionId: string,
    dto: RequestFeeDto,
    meta: RequestMetadata,
  ) {
    return this.request(user, inspectionId, dto, meta, { isRetry: true });
  }

  // -------------------------------------------------------------- webhook

  /**
   * Applies a `transaction:processed` event.
   *
   * Paypack fires this whether the transaction succeeded or not, and may
   * deliver it more than once or out of order — hence the early return on an
   * already-settled fee.
   */
  async applyWebhook(event: PaypackWebhookEvent): Promise<void> {
    const ref = event.data?.ref;
    const rawStatus = event.data?.status?.toLowerCase();

    if (!ref) {
      this.logger.warn('Paypack webhook received with no transaction ref.');
      return;
    }

    const fee = await this.prisma.inspectionFee.findUnique({
      where: { providerRef: ref },
      include: { inspection: { select: { organizationId: true, id: true } } },
    });

    if (!fee) {
      // Not ours, or for a different environment. Ignore quietly.
      this.logger.warn(`Paypack webhook for unknown ref ${ref}.`);
      return;
    }

    if (fee.status === FeeStatus.SUCCESSFUL) {
      return; // replay of an event already applied
    }

    const next = this.mapStatus(rawStatus);
    if (next === FeeStatus.PROCESSING) return; // nothing settled yet

    await this.settle(fee.id, next, {
      organizationId: fee.inspection.organizationId,
      inspectionId: fee.inspection.id,
      reason:
        next === FeeStatus.FAILED
          ? 'The payment was not completed. Ask the owner to try again.'
          : null,
      source: 'webhook',
    });
  }

  // ------------------------------------------------------- reconciliation

  /**
   * Asks Paypack directly when a PROCESSING record has gone quiet.
   *
   * Webhooks get lost. Without this an inspector stands at a property unable
   * to work, with a payment that actually succeeded.
   */
  private async reconcileIfStale(
    fee: {
      id: string;
      status: FeeStatus;
      providerRef: string | null;
      requestedAt: Date;
      inspectionId: string;
    },
    user: TenantContext,
    inspectionId: string,
  ) {
    if (fee.status !== FeeStatus.PROCESSING || !fee.providerRef) return fee;

    const age = Date.now() - fee.requestedAt.getTime();
    if (age < RECONCILE_AFTER_MS) return fee;

    if (age > PROCESSING_TIMEOUT_MS) {
      return this.settle(fee.id, FeeStatus.FAILED, {
        organizationId: user.organizationId,
        inspectionId,
        reason: 'The payment request expired. Please send it again.',
        source: 'timeout',
      });
    }

    try {
      const tx = await this.paypack.find(fee.providerRef);
      const next = this.mapStatus(tx.status);

      if (next === FeeStatus.PROCESSING) return fee;

      return this.settle(fee.id, next, {
        organizationId: user.organizationId,
        inspectionId,
        reason:
          next === FeeStatus.FAILED
            ? 'The payment was not completed. Ask the owner to try again.'
            : null,
        source: 'reconciliation',
      });
    } catch (error) {
      // A failed lookup must not break the polling endpoint — the next poll
      // tries again.
      this.logger.warn(
        `Reconciliation failed for fee ${fee.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fee;
    }
  }

  // -------------------------------------------------------------- helpers

  private async settle(
    feeId: string,
    status: FeeStatus,
    ctx: {
      organizationId: string;
      inspectionId: string;
      reason: string | null;
      source: string;
    },
  ) {
    const updated = await this.prisma.inspectionFee.update({
      where: { id: feeId },
      data: {
        status,
        settledAt: status === FeeStatus.SUCCESSFUL ? new Date() : null,
        failureReason: ctx.reason,
      },
    });

    await this.audit.record({
      organizationId: ctx.organizationId,
      userId: null, // Paypack acted, not a user
      action: `INSPECTION_FEE_${status}`,
      entityType: 'InspectionFee',
      entityId: feeId,
      newValue: {
        inspectionId: ctx.inspectionId,
        status,
        providerRef: updated.providerRef,
        source: ctx.source,
      },
    });

    return updated;
  }

  /** Anything not explicitly successful or failed is still in flight. */
  private mapStatus(raw: string | undefined): FeeStatus {
    switch (raw) {
      case 'successful':
      case 'success':
        return FeeStatus.SUCCESSFUL;
      case 'failed':
      case 'rejected':
      case 'cancelled':
        return FeeStatus.FAILED;
      default:
        return FeeStatus.PROCESSING;
    }
  }

  /** Rwandan MoMo numbers, normalised to the local 07XXXXXXXX form. */
  private normalisePhone(raw: string): string {
    let s = raw.replace(/[\s\-()]/g, '');
    if (s.startsWith('+250')) s = `0${s.slice(4)}`;
    if (s.startsWith('250')) s = `0${s.slice(3)}`;

    if (!/^07[2389]\d{7}$/.test(s)) {
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        'Enter a valid Rwandan mobile money number, for example 0788123456.',
      );
    }
    return s;
  }

  private async loadInspection(user: TenantContext, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        status: true,
        inspectorId: true,
        inspectionNumber: true,
      },
    });

    if (!inspection) {
      throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    }

    if (!canAccessBranch(user, inspection.branchId)) {
      throw new ForbiddenError(
        'This inspection belongs to a branch you do not have access to.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    return inspection;
  }
}
