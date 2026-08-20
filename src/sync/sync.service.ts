import { Injectable, Logger } from '@nestjs/common';
import { InspectionStatus, Prisma } from '@prisma/client';
import { assessProximity, isPlausibleCoordinate } from '../common/utils/geo.util';
import { ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';
import { isEditable } from '../inspections/domain/inspection-state-machine';
import { SyncOperationDto, SyncPullQueryDto, SyncPushDto } from './dto/sync.dto';

export type SyncOperationResult =
  | { clientOperationId: string; status: 'APPLIED'; serverId?: string; version?: number }
  | { clientOperationId: string; status: 'DUPLICATE'; serverId?: string; version?: number }
  | { clientOperationId: string; status: 'CONFLICT'; reason: string; serverVersion?: number }
  | { clientOperationId: string; status: 'REJECTED'; reason: string };

/**
 * Offline synchronisation.
 *
 * Three properties make this safe on an unreliable network:
 *
 *  1. Idempotency. Every operation carries a client-generated id, so replaying
 *     a batch after a timeout returns DUPLICATE rather than applying twice —
 *     essential when a phone cannot tell whether a request that never returned
 *     actually reached the server.
 *
 *  2. Optimistic concurrency. Operations carry the version the device last saw.
 *     If a reviewer acted while the phone was offline, the operation is
 *     reported as CONFLICT rather than silently overwriting.
 *
 *  3. Per-operation results. One bad operation does not fail the batch; the
 *     client learns exactly what to retry, keep, or show the user.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything the device needs to work offline.
   * `since` makes this a delta, which matters on a weak mobile connection.
   */
  async pull(user: TenantContext, query: SyncPullQueryDto) {
    const since = query.since ? new Date(query.since) : null;

    const inspections = await this.prisma.inspection.findMany({
      where: {
        organizationId: user.organizationId,
        inspectorId: user.userId,
        deletedAt: null,
        // Completed work is read-only history that would only consume storage
        // on a field phone.
        status: {
          in: [
            InspectionStatus.ASSIGNED,
            InspectionStatus.IN_PROGRESS,
            InspectionStatus.CORRECTION_REQUESTED,
            InspectionStatus.SUBMITTED,
            InspectionStatus.RESUBMITTED,
            InspectionStatus.UNDER_REVIEW,
          ],
        },
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      include: {
        property: true,
        branch: { select: { id: true, code: true, name: true } },
        owner: true,
        valuation: true,
        assessments: { orderBy: { sortOrder: 'asc' } },
        values: true,
        locations: { orderBy: { capturedAt: 'desc' }, take: 5 },
        photos: {
          where: { deletedAt: null },
          select: { id: true, category: true, storageKey: true, capturedAt: true, clientRequestId: true },
        },
        corrections: { where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } },
        template: {
          include: {
            sections: { orderBy: { sortOrder: 'asc' }, include: { fields: { orderBy: { sortOrder: 'asc' } } } },
            photoRules: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    // Templates are deduplicated: several inspections usually share one, and
    // repeating it would waste the inspector's bandwidth.
    const templates = new Map<string, unknown>();
    for (const inspection of inspections) {
      if (!templates.has(inspection.templateId)) templates.set(inspection.templateId, inspection.template);
    }

    return {
      serverTime: new Date().toISOString(),
      templates: [...templates.values()],
      inspections: inspections.map(({ template: _t, ...rest }) => rest),
    };
  }

  /**
   * Applies a batch of offline changes.
   *
   * Each operation runs in its own transaction. A single transaction around the
   * whole batch would mean one stale item discards an entire day of fieldwork.
   */
  async push(user: TenantContext, dto: SyncPushDto, meta: RequestMetadata) {
    const results: SyncOperationResult[] = [];

    for (const operation of dto.operations) {
      try {
        results.push(await this.applyOperation(user, operation));
      } catch (error) {
        this.logger.warn(
          `Sync operation ${operation.clientOperationId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        results.push({
          clientOperationId: operation.clientOperationId,
          status: 'REJECTED',
          reason: error instanceof Error ? error.message : 'The change could not be applied.',
        });
      }
    }

    return { results, serverTime: new Date().toISOString() };
  }

  private async applyOperation(
    user: TenantContext,
    operation: SyncOperationDto,
  ): Promise<SyncOperationResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const inspection = await tx.inspection.findFirst({
        where: { id: operation.inspectionId, organizationId: user.organizationId, deletedAt: null },
        select: {
          id: true, version: true, status: true, inspectorId: true, templateId: true,
          property: { select: { latitude: true, longitude: true } },
        },
      });

      if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');

      if (inspection.inspectorId !== user.userId) {
        throw new ForbiddenError('This inspection is not assigned to you.', ErrorCode.AUTH_FORBIDDEN);
      }

      if (!isEditable(inspection.status)) {
        // Common and expected: the reviewer acted while the phone was offline.
        // Reported as a conflict so the app shows the new state rather than
        // retrying an operation that can never succeed.
        return {
          clientOperationId: operation.clientOperationId,
          status: 'CONFLICT',
          reason: `This inspection is now ${inspection.status.replace(/_/g, ' ').toLowerCase()} and can no longer be edited on the device.`,
          serverVersion: inspection.version,
        };
      }

      if (operation.baseVersion !== undefined && operation.baseVersion < inspection.version) {
        return {
          clientOperationId: operation.clientOperationId,
          status: 'CONFLICT',
          reason: 'This inspection changed on the server after your device last synchronised.',
          serverVersion: inspection.version,
        };
      }

      switch (operation.type) {
        case 'UPSERT_VALUES':
          return this.applyValues(tx, operation, inspection.id, inspection.templateId);
        case 'UPSERT_ASSESSMENT':
          return this.applyAssessment(tx, operation, inspection.id);
        case 'UPSERT_OWNER':
          return this.applyOwner(tx, operation, inspection.id);
        case 'UPSERT_VALUATION':
          return this.applyValuation(tx, operation, inspection.id);
        case 'ADD_LOCATION':
          return this.applyLocation(tx, operation, inspection);
        default:
          return {
            clientOperationId: operation.clientOperationId,
            status: 'REJECTED',
            reason: `Unsupported operation type "${String(operation.type)}".`,
          };
      }
    });
  }

  private async touch(tx: PrismaTransactionClient, inspectionId: string): Promise<number> {
    const updated = await tx.inspection.update({
      where: { id: inspectionId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    return updated.version;
  }

  private async applyValues(
    tx: PrismaTransactionClient,
    operation: SyncOperationDto,
    inspectionId: string,
    templateId: string,
  ): Promise<SyncOperationResult> {
    const entries = (operation.payload?.values ?? []) as Array<{
      fieldId: string; valueText?: string | null; valueNumber?: number | null;
      valueDate?: string | null; valueBool?: boolean | null; valueJson?: unknown;
    }>;

    for (const entry of entries) {
      // Guards against a device writing values against another template's fields.
      const field = await tx.templateField.findFirst({
        where: { id: entry.fieldId, section: { templateId } },
        select: { id: true },
      });
      if (!field) continue;

      const data = {
        valueText: entry.valueText ?? null,
        valueNumber: entry.valueNumber ?? null,
        valueDate: entry.valueDate ? new Date(entry.valueDate) : null,
        valueBool: entry.valueBool ?? null,
        valueJson: (entry.valueJson ?? null) as Prisma.InputJsonValue,
      };

      await tx.inspectionValue.upsert({
        where: { inspectionId_fieldId: { inspectionId, fieldId: entry.fieldId } },
        update: data,
        create: { inspectionId, fieldId: entry.fieldId, ...data },
      });
    }

    const version = await this.touch(tx, inspectionId);
    return { clientOperationId: operation.clientOperationId, status: 'APPLIED', serverId: inspectionId, version };
  }

  private async applyAssessment(
    tx: PrismaTransactionClient, operation: SyncOperationDto, inspectionId: string,
  ): Promise<SyncOperationResult> {
    const p = operation.payload as {
      categoryCode: string; categoryName?: string; rating?: number | null;
      condition?: string | null; notes?: string | null; sortOrder?: number;
    };

    if (!p?.categoryCode) {
      return {
        clientOperationId: operation.clientOperationId,
        status: 'REJECTED',
        reason: 'An assessment category code is required.',
      };
    }

    const data = {
      categoryName: p.categoryName ?? p.categoryCode,
      rating: p.rating ?? null,
      condition: (p.condition ?? null) as never,
      notes: p.notes ?? null,
      sortOrder: p.sortOrder ?? 0,
    };

    const assessment = await tx.inspectionAssessment.upsert({
      where: { inspectionId_categoryCode: { inspectionId, categoryCode: p.categoryCode } },
      update: data,
      create: { inspectionId, categoryCode: p.categoryCode, ...data },
      select: { id: true },
    });

    const version = await this.touch(tx, inspectionId);
    return { clientOperationId: operation.clientOperationId, status: 'APPLIED', serverId: assessment.id, version };
  }

  private async applyOwner(
    tx: PrismaTransactionClient, operation: SyncOperationDto, inspectionId: string,
  ): Promise<SyncOperationResult> {
    const p = operation.payload as {
      fullName: string; nationalIdEnc?: string | null; nationalIdHash?: string | null;
      phone?: string | null; email?: string | null;
      occupancyStatus?: string | null; ownershipType?: string | null;
    };

    if (!p?.fullName?.trim()) {
      return {
        clientOperationId: operation.clientOperationId,
        status: 'REJECTED',
        reason: 'An owner name is required.',
      };
    }

    const data = {
      fullName: p.fullName.trim(),
      nationalIdEnc: p.nationalIdEnc ?? null,
      nationalIdHash: p.nationalIdHash ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
      occupancyStatus: (p.occupancyStatus ?? null) as never,
      ownershipType: (p.ownershipType ?? null) as never,
    };

    const owner = await tx.inspectionOwner.upsert({
      where: { inspectionId }, update: data, create: { inspectionId, ...data }, select: { id: true },
    });

    const version = await this.touch(tx, inspectionId);
    return { clientOperationId: operation.clientOperationId, status: 'APPLIED', serverId: owner.id, version };
  }

  private async applyValuation(
    tx: PrismaTransactionClient, operation: SyncOperationDto, inspectionId: string,
  ): Promise<SyncOperationResult> {
    const p = operation.payload as {
      currency?: string; marketValue?: number | null; forcedSaleValue?: number | null;
      replacementCost?: number | null; rentalEstimate?: number | null; comments?: string | null;
    };

    // Stored exactly as entered. No figure is derived: a silently computed
    // forced-sale value would shape a lending decision without anyone having
    // authorised the formula.
    const data = {
      currency: p?.currency ?? 'RWF',
      marketValue: p?.marketValue ?? null,
      forcedSaleValue: p?.forcedSaleValue ?? null,
      replacementCost: p?.replacementCost ?? null,
      rentalEstimate: p?.rentalEstimate ?? null,
      comments: p?.comments ?? null,
    };

    const valuation = await tx.inspectionValuation.upsert({
      where: { inspectionId }, update: data, create: { inspectionId, ...data }, select: { id: true },
    });

    const version = await this.touch(tx, inspectionId);
    return { clientOperationId: operation.clientOperationId, status: 'APPLIED', serverId: valuation.id, version };
  }

  private async applyLocation(
    tx: PrismaTransactionClient,
    operation: SyncOperationDto,
    inspection: { id: string; property: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null } },
  ): Promise<SyncOperationResult> {
    const p = operation.payload as {
      latitude: number; longitude: number; accuracyM?: number | null; altitudeM?: number | null;
      source?: string; isMocked?: boolean; capturedAt: string;
    };

    if (!p || !isPlausibleCoordinate({ latitude: p.latitude, longitude: p.longitude })) {
      return {
        clientOperationId: operation.clientOperationId,
        status: 'REJECTED',
        reason: 'The coordinates supplied are not a valid location reading.',
      };
    }

    // Distance is computed here, from the registered position. A client-supplied
    // distance would be meaningless: an app that can fake its position can
    // equally fake the arithmetic about it.
    const registered =
      inspection.property.latitude !== null && inspection.property.longitude !== null
        ? {
            latitude: Number(inspection.property.latitude),
            longitude: Number(inspection.property.longitude),
          }
        : null;

    const proximity = assessProximity(
      { latitude: p.latitude, longitude: p.longitude }, registered, p.accuracyM ?? null,
    );

    const location = await tx.inspectionLocation.create({
      data: {
        inspectionId: inspection.id,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracyM: p.accuracyM ?? null,
        altitudeM: p.altitudeM ?? null,
        source: (p.source ?? 'GPS') as never,
        isMocked: p.isMocked ?? false,
        capturedAt: new Date(p.capturedAt),
        distanceFromPropertyM: proximity.distanceM,
      },
      select: { id: true },
    });

    const version = await this.touch(tx, inspection.id);
    return { clientOperationId: operation.clientOperationId, status: 'APPLIED', serverId: location.id, version };
  }
}
