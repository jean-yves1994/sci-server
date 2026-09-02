import { Injectable, Logger } from '@nestjs/common';
import { InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { BadRequestError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, buildTenantScope, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { InspectionAction, evaluateTransition } from '../inspections/domain/inspection-state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageProvider } from '../providers/storage/storage.provider';
import { ReportData, ReportRenderer } from './report-renderer';

const DOWNLOAD_TTL_SECONDS = 300;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: ReportRenderer,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Generates the official PDF for an approved inspection.
   *
   * Re-running produces a new version rather than overwriting: a report that
   * has already been shared with a credit committee must remain retrievable
   * exactly as it was issued.
   */
  async generate(user: TenantContext, inspectionId: string, meta: RequestMetadata) {
    const inspection = await this.loadForReport(user.organizationId, inspectionId);

    if (!inspection) {
      throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    }

    const outcome = evaluateTransition({
      action: InspectionAction.GENERATE_REPORT,
      currentStatus: inspection.status,
      userId: user.userId,
      permissions: user.permissions,
      inspectorId: inspection.inspectorId,
      submittedById: null,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.REPORT_NOT_READY, outcome.reason);
    }

    const existingCount = await this.prisma.report.count({ where: { inspectionId } });
    const version = existingCount + 1;
    const reportNumber = this.buildReportNumber(inspection.inspectionNumber);

    const pdf = await this.renderer.render(this.toReportData(inspection, reportNumber, version, user));

    const storageKey = `reports/${inspection.organizationId}/${reportNumber}-v${version}.pdf`;
    const stored = await this.storage.put(storageKey, pdf, 'application/pdf');

    const report = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          organizationId: inspection.organizationId,
          inspectionId,
          reportNumber,
          version,
          storageKey: stored.key,
          checksumSha256: stored.checksumSha256,
          sizeBytes: stored.sizeBytes,
          generatedById: user.userId,
        },
      });

      await tx.inspection.update({
        where: { id: inspectionId },
        data: { status: InspectionStatus.REPORT_GENERATED, version: { increment: 1 } },
      });

      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId,
          fromStatus: inspection.status,
          toStatus: InspectionStatus.REPORT_GENERATED,
          actorId: user.userId,
          comment: `Report ${reportNumber} version ${version} generated.`,
        },
      });

      if (inspection.inspectorId) {
        await this.notifications.create(
          {
            userId: inspection.inspectorId,
            type: 'REPORT_READY',
            title: 'Report available',
            message: `The official report for ${inspection.inspectionNumber} is ready to download.`,
            entityType: 'Report',
            entityId: created.id,
          },
          tx,
        );
      }

      await this.audit.record(
        {
          organizationId: inspection.organizationId,
          userId: user.userId,
          action: 'REPORT_GENERATED',
          entityType: 'Report',
          entityId: created.id,
          metadata: {
            reportNumber,
            version,
            inspectionNumber: inspection.inspectionNumber,
            checksum: stored.checksumSha256,
          },
          meta,
        },
        tx,
      );

      return created;
    });

    return report;
  }

  async list(
    user: TenantContext,
    query: { page: number; pageSize: number; search?: string },
  ): Promise<PaginatedResult<unknown>> {
    const scope = buildTenantScope(user);

    const where = {
      organizationId: scope.organizationId,
      ...(scope.branchId ? { inspection: { branchId: scope.branchId } } : {}),
      ...(query.search
        ? {
            OR: [
              { reportNumber: { contains: query.search, mode: 'insensitive' as const } },
              {
                inspection: {
                  inspectionNumber: { contains: query.search, mode: 'insensitive' as const },
                },
              },
              {
                inspection: {
                  loanReference: { contains: query.search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          inspection: {
            select: {
              id: true,
              inspectionNumber: true,
              loanReference: true,
              submittedAt: true,
              property: { select: { reference: true, addressLine: true } },
              inspector: { select: { firstName: true, lastName: true } },
              reviewer: { select: { firstName: true, lastName: true } },
            },
          },
          generatedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  /**
   * Issues a short-lived download URL.
   *
   * Authorisation is checked here rather than relying on the URL being secret,
   * and every download is audited — for a document that informs a credit
   * decision, who read it is itself worth recording.
   */
  async getDownloadUrl(
    user: TenantContext,
    reportId: string,
    meta: RequestMetadata,
    disposition: 'inline' | 'attachment' = 'attachment',
  ): Promise<{ url: string; expiresIn: number; reportNumber: string }> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, organizationId: user.organizationId },
      include: { inspection: { select: { branchId: true, inspectionNumber: true } } },
    });

    if (!report) throw new NotFoundError(ErrorCode.NOT_FOUND, 'Report not found.');

    if (!canAccessBranch(user, report.inspection.branchId)) {
      throw new ForbiddenError(
        'This report belongs to a branch you do not have access to.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    const url = await this.storage.getSignedUrl(report.storageKey, DOWNLOAD_TTL_SECONDS, disposition);

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.userId,
      action: 'REPORT_DOWNLOADED',
      entityType: 'Report',
      entityId: report.id,
      metadata: { reportNumber: report.reportNumber, disposition },
      meta,
    });

    return { url, expiresIn: DOWNLOAD_TTL_SECONDS, reportNumber: report.reportNumber };
  }

  // -------------------------------------------------------------------------

  private buildReportNumber(inspectionNumber: string): string {
    // Derived from the inspection number so the two are obviously related on
    // paper, which matters when someone is reconciling a physical file.
    return inspectionNumber.replace(/^INS-/, 'RPT-');
  }

  private loadForReport(organizationId: string, id: string) {
    return this.prisma.inspection.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        organization: true,
        branch: true,
        property: { include: { division: true } },
        owner: true,
        valuation: true,
        inspector: { select: { firstName: true, lastName: true } },
        reviewer: { select: { firstName: true, lastName: true } },
        assessments: { orderBy: { sortOrder: 'asc' } },
        locations: { orderBy: { capturedAt: 'desc' }, take: 1 },
        photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        values: { include: { field: { include: { section: true } } } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { firstName: true, lastName: true } } },
        },
        statusEvents: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { firstName: true, lastName: true } } },
        },
      },
    });
  }

  /**
   * Maps stored records onto the renderer's input.
   *
   * Every field is read from the database. Nothing is defaulted or derived: a
   * figure appearing only in the PDF would be one the institution never
   * recorded, and this document may be relied upon.
   */
  private toReportData(
    inspection: NonNullable<Awaited<ReturnType<ReportsService['loadForReport']>>>,
    reportNumber: string,
    version: number,
    user: TenantContext,
  ): ReportData {
    const location = inspection.locations[0];

    const fieldValues = inspection.values
      .map((value) => ({
        section: value.field.section.name,
        sortOrder: value.field.sortOrder,
        label: value.field.label,
        value: this.stringifyValue(value),
      }))
      .filter((entry) => entry.value !== '')
      .sort((a, b) => a.section.localeCompare(b.section) || a.sortOrder - b.sortOrder);

    const propertyAddress = [
      inspection.property.villageStreet,
      inspection.property.cell,
      inspection.property.sector,
      inspection.property.district,
      inspection.property.province,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(', ');

    return {
      organization: {
        name: inspection.organization.name,
        legalName: inspection.organization.legalName,
        addressLine: inspection.organization.addressLine,
        phone: inspection.organization.phone,
        email: inspection.organization.email,
      },
      reportNumber,
      version,
      generatedAt: new Date(),
      generatedBy: user.userId,
      inspection: {
        inspectionNumber: inspection.inspectionNumber,
        loanReference: inspection.loanReference,
        clientName: inspection.clientName,
        status: inspection.status,
        submittedAt: inspection.submittedAt,
        approvedAt: inspection.approvedAt,
        branch: `${inspection.branch.code} — ${inspection.branch.name}`,
      },
      property: {
        reference: inspection.property.reference,
        propertyType: inspection.property.propertyType,
        addressLine: propertyAddress || inspection.property.addressLine || '—',
        plotNumber: inspection.property.plotNumber,
        titleNumber: inspection.property.titleNumber,
        division: inspection.property.division?.name ?? null,
      },
      owner: inspection.owner
        ? {
            fullName: inspection.owner.fullName,
            phone: inspection.owner.phone,
            email: inspection.owner.email,
            occupancyStatus: inspection.owner.occupancyStatus,
            ownershipType: inspection.owner.ownershipType,
          }
        : null,
      people: {
        inspector: inspection.inspector
          ? `${inspection.inspector.firstName} ${inspection.inspector.lastName}`
          : null,
        reviewer: inspection.reviewer
          ? `${inspection.reviewer.firstName} ${inspection.reviewer.lastName}`
          : null,
      },
      location: location
        ? {
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
            accuracyM: location.accuracyM,
            capturedAt: location.capturedAt,
            distanceFromPropertyM: location.distanceFromPropertyM,
          }
        : null,
      assessments: inspection.assessments.map((a) => ({
        categoryName: a.categoryName,
        rating: a.rating,
        condition: a.condition,
        notes: a.notes,
      })),
      valuation: inspection.valuation
        ? {
            currency: inspection.valuation.currency,
            marketValue: inspection.valuation.marketValue === null ? null : Number(inspection.valuation.marketValue),
            forcedSaleValue: inspection.valuation.forcedSaleValue === null ? null : Number(inspection.valuation.forcedSaleValue),
            replacementCost: inspection.valuation.replacementCost === null ? null : Number(inspection.valuation.replacementCost),
            rentalEstimate: inspection.valuation.rentalEstimate === null ? null : Number(inspection.valuation.rentalEstimate),
            comments: inspection.valuation.comments,
          }
        : null,
      fieldValues: fieldValues.map(({ section, label, value }) => ({ section, label, value })),
      photos: inspection.photos.map((p) => ({
        category: p.category,
        storageKey: p.storageKey,
        caption: p.caption,
        capturedAt: p.capturedAt,
      })),
      reviewerComments: inspection.comments.map((c) => ({
        author: `${c.author.firstName} ${c.author.lastName}`,
        body: c.body,
        createdAt: c.createdAt,
        type: c.type,
      })),
      timeline: inspection.statusEvents.map((e) => ({
        toStatus: e.toStatus,
        actor: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : null,
        createdAt: e.createdAt,
        comment: e.comment,
      })),
    };
  }

  private stringifyValue(value: {
    valueText: string | null;
    valueNumber: unknown;
    valueDate: Date | null;
    valueBool: boolean | null;
    valueJson: unknown;
  }): string {
    if (value.valueText) return value.valueText;
    if (value.valueNumber !== null && value.valueNumber !== undefined) return String(value.valueNumber);
    if (value.valueDate) return new Date(value.valueDate).toLocaleDateString('en-GB');
    if (value.valueBool !== null && value.valueBool !== undefined) return value.valueBool ? 'Yes' : 'No';
    if (Array.isArray(value.valueJson)) return value.valueJson.join(', ');
    if (value.valueJson) return String(value.valueJson);
    return '';
  }
}
