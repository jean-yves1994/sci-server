import { Injectable, Logger } from '@nestjs/common';
import { FeeStatus, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaypackClient } from './paypack.client';

/** The standard inspection fee, in RWF. The server is the authority. */
const FEE_AMOUNT_RWF = 15_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypack: PaypackClient,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Requests the fee from the client's own phone.
   *
   * Note what this does NOT do: it does not check whether the inspection is
   * complete, and nothing downstream consults the fee before allowing a
   * submission. A borrower with a flat battery must not be able to prevent an
   * inspector from recording what they travelled to record.
   */
  async request(
    inspectionId: string,
    phoneNumber: string,
    actor: { userId: string; organizationId: string },
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, organizationId: actor.organizationId },
      select: { id: true, inspectionNumber: true, inspectorId: true },
    });

    if (!inspection) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Inspection not found.', 404);
    }

    // Only the assigned inspector may request the fee. Without this, any
    // authenticated user could trigger a charge against any borrower.
    if (inspection.inspectorId !== actor.userId) {
      throw new DomainError(
        ErrorCode.AUTH_FORBIDDEN,
        'Only the assigned inspector can request the inspection fee.',
        403,
      );
    }

    const existing = await this.prisma.inspectionFee.findUnique({
      where: { inspectionId },
    });

    // Already settled, or already awaiting the client. Returning the existing
    // record rather than creating a second one is what stops a double charge
    // when an inspector taps twice on a slow connection.
    if (existing && existing.status !== FeeStatus.FAILED) {
      return existing;
    }

    const idempotencyKey = `fee-${inspectionId}`.slice(0, 32);

    let providerRef: string;
    try {
      const result = await this.paypack.cashin({
        amount: FEE_AMOUNT_RWF,
        phoneNumber,
        idempotencyKey,
      });
      providerRef = result.ref;
    } catch (error) {
      this.logger.warn(
        `Fee request failed for ${inspection.inspectionNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    const fee = await this.prisma.inspectionFee.upsert({
      where: { inspectionId },
      create: {
        inspectionId,
        amount: FEE_AMOUNT_RWF,
        phoneNumber,
        status: FeeStatus.PENDING,
        providerRef,
        requestedById: actor.userId,
      },
      update: {
        phoneNumber,
        status: FeeStatus.PENDING,
        providerRef,
        failureReason: null,
        requestedById: actor.userId,
        requestedAt: new Date(),
      },
    });

    await this.audit.record({
      organizationId: actor.organizationId,
      action: 'INSPECTION_FEE_REQUESTED',
      entityType: 'InspectionFee',
      entityId: fee.id,
      userId: actor.userId,
      metadata: {
        inspectionNumber: inspection.inspectionNumber,
        amount: FEE_AMOUNT_RWF,
        // Last four digits only. The full number is on the record; the audit
        // log is read far more widely than the record is.
        phoneSuffix: phoneNumber.slice(-4),
      },
    });

    return fee;
  }

  async status(inspectionId: string, organizationId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, organizationId },
      select: { id: true },
    });

    if (!inspection) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Inspection not found.', 404);
    }

    const fee = await this.prisma.inspectionFee.findUnique({
      where: { inspectionId },
    });

    return fee ?? { status: 'NONE', amount: FEE_AMOUNT_RWF };
  }

  /**
   * Verifies a Paypack webhook signature.
   *
   * Compared in constant time: a plain `===` short-circuits on the first
   * differing byte and leaks, over many attempts, how much of a forged
   * signature was correct.
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('PAYPACK_WEBHOOK_SECRET');
    if (!secret) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);

    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Settles a transaction from a webhook.
   *
   * Keyed on the provider reference and guarded against replay: a webhook that
   * arrives twice, or arrives after a poll has already settled the row, must
   * not produce two settlements.
   */
  async settle(providerRef: string, status: string) {
    const fee = await this.prisma.inspectionFee.findUnique({
      where: { providerRef },
      include: {
        inspection: {
          select: {
            inspectionNumber: true,
            organizationId: true,
          },
        },
      },
    });

    if (!fee) {
      this.logger.warn(`Webhook for unknown transaction ${providerRef}`);
      return;
    }

    if (fee.status !== FeeStatus.PENDING) {
      // Already settled. Not an error — webhooks are at-least-once.
      return;
    }

    const settled = status.toLowerCase() === 'successful';

    await this.prisma.inspectionFee.update({
      where: { id: fee.id },
      data: {
        status: settled ? FeeStatus.SUCCESSFUL : FeeStatus.FAILED,
        settledAt: new Date(),
        failureReason: settled ? null : 'The payment was not completed.',
      },
    });

    await this.audit.record({
      organizationId: fee.inspection.organizationId,
      action: settled ? 'INSPECTION_FEE_PAID' : 'INSPECTION_FEE_FAILED',
      entityType: 'InspectionFee',
      entityId: fee.id,
      userId: null,
      metadata: {
        inspectionNumber: fee.inspection.inspectionNumber,
        providerRef,
        amount: fee.amount,
      },
    });
  }

  /**
   * Reconciles anything the webhook missed.
   *
   * Webhooks get lost. Without this, a client who paid would show as unpaid
   * indefinitely, and someone would eventually ask them to pay again.
   */
  async reconcilePending() {
    const stale = await this.prisma.inspectionFee.findMany({
      where: {
        status: FeeStatus.PENDING,
        providerRef: { not: null },
        requestedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
      },
      take: 50,
    });

    for (const fee of stale) {
      const result = await this.paypack.find(fee.providerRef!);
      if (result && result.status.toLowerCase() !== 'pending') {
        await this.settle(fee.providerRef!, result.status);
      }
    }
  }
}
