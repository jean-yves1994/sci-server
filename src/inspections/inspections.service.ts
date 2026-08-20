import { Injectable, Logger } from '@nestjs/common';
import { ConditionStatus, FieldType, InspectionStatus, PhotoCategory, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { blindIndex, encryptField } from '../common/utils/crypto.util';
import { assessProximity, isPlausibleCoordinate } from '../common/utils/geo.util';
import {
  RequestMetadata,
  TenantContext,
  buildTenantScope,
  canAccessBranch,
} from '../common/tenant-context';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AssignInspectionDto,
  CaptureLocationDto,
  CreateInspectionDto,
  InspectionQueryDto,
  SaveAssessmentDto,
  SaveOwnerDto,
  SaveValuationDto,
  SaveValuesDto,
} from './dto/inspection.dto';
import {
  CompletenessResult,
  FieldValidation,
  evaluateCompleteness,
} from './domain/completeness';
import {
  InspectionAction,
  REVIEW_QUEUE_STATUSES,
  evaluateTransition,
  isEditable,
} from './domain/inspection-state-machine';

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async list(user: TenantContext, query: InspectionQueryDto): Promise<PaginatedResult<unknown>> {
    const scope = buildTenantScope(user);

    const where: Prisma.InspectionWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.inspectorId ? { inspectorId: query.inspectorId } : {}),
      ...(query.reviewerId ? { reviewerId: query.reviewerId } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignedToMe ? { inspectorId: user.userId } : {}),
      ...(query.propertyType ? { property: { propertyType: query.propertyType } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      // Search runs in the database, not the browser. Filtering thousands of
      // records client-side would be both slow and a data-exposure problem.
      ...(query.search
        ? {
            OR: [
              { inspectionNumber: { contains: query.search, mode: 'insensitive' } },
              { loanReference: { contains: query.search, mode: 'insensitive' } },
              { clientName: { contains: query.search, mode: 'insensitive' } },
              { property: { reference: { contains: query.search, mode: 'insensitive' } } },
              { property: { addressLine: { contains: query.search, mode: 'insensitive' } } },
              { owner: { fullName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);

    const [rows, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        // Selected explicitly: a list view has no need for photos, values or
        // snapshots, and loading them would be an N+1 waiting to happen.
        select: {
          id: true,
          inspectionNumber: true,
          loanReference: true,
          clientName: true,
          status: true,
          priority: true,
          dueDate: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
          version: true,
          property: {
            select: { id: true, reference: true, propertyType: true, addressLine: true },
          },
          branch: { select: { id: true, code: true, name: true } },
          inspector: { select: { id: true, firstName: true, lastName: true } },
          reviewer: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { photos: true } },
        },
      }),
      this.prisma.inspection.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  /** The reviewer's queue: everything awaiting a decision, oldest submission first. */
  reviewQueue(user: TenantContext, query: InspectionQueryDto): Promise<PaginatedResult<unknown>> {
    return this.list(user, {
      ...query,
      status: query.status?.length ? query.status : REVIEW_QUEUE_STATUSES,
      sortBy: query.sortBy ?? 'submittedAt',
      // Oldest first so the queue drains fairly rather than leaving early
      // submissions stranded behind newer ones.
      sortDir: query.sortDir ?? 'asc',
    });
  }

  async findOne(user: TenantContext, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: {
        property: { include: { division: true } },
        branch: { select: { id: true, code: true, name: true } },
        inspector: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        owner: true,
        valuation: true,
        assessments: { orderBy: { sortOrder: 'asc' } },
        values: { include: { field: { include: { section: true } } } },
        locations: { orderBy: { capturedAt: 'desc' } },
        photos: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { capturedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
        statusEvents: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, firstName: true, lastName: true } } },
        },
        corrections: {
          orderBy: { createdAt: 'desc' },
          include: { requestedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        reports: { orderBy: { generatedAt: 'desc' } },
        template: {
          include: {
            sections: {
              orderBy: { sortOrder: 'asc' },
              include: { fields: { orderBy: { sortOrder: 'asc' } } },
            },
            photoRules: true,
          },
        },
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

    // Proximity is derived on read rather than stored as a verdict, so changing
    // the tolerance policy does not require rewriting historical rows.
    const latest = inspection.locations[0];
    const proximity = latest
      ? assessProximity(
          { latitude: Number(latest.latitude), longitude: Number(latest.longitude) },
          inspection.property.latitude !== null && inspection.property.longitude !== null
            ? {
                latitude: Number(inspection.property.latitude),
                longitude: Number(inspection.property.longitude),
              }
            : null,
          latest.accuracyM,
        )
      : null;

    return {
      ...inspection,
      completeness: this.computeCompleteness(inspection),
      proximity,
    };
  }

  /** The §17 review summary, used by both the app and the submit guard. */
  async completeness(user: TenantContext, id: string): Promise<CompletenessResult> {
    const inspection = await this.loadForCompleteness(user.organizationId, id);
    if (!inspection) {
      throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    }
    return this.computeCompleteness(inspection);
  }

  // -------------------------------------------------------------------------
  // Creating and assigning
  // -------------------------------------------------------------------------

  async create(user: TenantContext, dto: CreateInspectionDto, meta: RequestMetadata) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true, reference: true },
    });

    if (!property) throw new NotFoundError(ErrorCode.NOT_FOUND, 'Property not found.');

    if (!canAccessBranch(user, property.branchId)) {
      throw new ForbiddenError(
        'You cannot raise an inspection for that branch.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    const template = dto.templateId
      ? await this.prisma.inspectionTemplate.findFirst({
          where: { id: dto.templateId, organizationId: user.organizationId, status: 'ACTIVE' },
          select: { id: true },
        })
      : await this.prisma.inspectionTemplate.findFirst({
          where: { organizationId: user.organizationId, isDefault: true, status: 'ACTIVE' },
          orderBy: { version: 'desc' },
          select: { id: true },
        });

    if (!template) {
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        'No active inspection template is available. Ask an administrator to configure one.',
      );
    }

    if (dto.inspectorId) await this.assertInspector(user, dto.inspectorId);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const inspectionNumber = await this.nextInspectionNumber(tx, user.organizationId);

      const inspection = await tx.inspection.create({
        data: {
          organizationId: user.organizationId,
          branchId: property.branchId,
          propertyId: property.id,
          templateId: template.id,
          inspectionNumber,
          loanReference: dto.loanReference.trim(),
          clientName: dto.clientName?.trim() ?? null,
          createdById: user.userId,
          inspectorId: dto.inspectorId ?? null,
          reviewerId: dto.reviewerId ?? null,
          priority: dto.priority ?? 'NORMAL',
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          assignmentNotes: dto.notes?.trim() ?? null,
          status: InspectionStatus.ASSIGNED,
        },
      });

      // The assessment rows are materialised now, from the template, so the
      // inspector opens a ready checklist and every inspection is comparable.
      const assessmentSections = await tx.templateSection.findMany({
        where: { templateId: template.id, isAssessment: true },
        orderBy: { sortOrder: 'asc' },
      });

      if (assessmentSections.length > 0) {
        await tx.inspectionAssessment.createMany({
          data: assessmentSections.map((section) => ({
            inspectionId: inspection.id,
            categoryCode: section.code,
            categoryName: section.name,
            sortOrder: section.sortOrder,
          })),
        });
      }

      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId: inspection.id,
          fromStatus: null,
          toStatus: InspectionStatus.ASSIGNED,
          actorId: user.userId,
          comment: dto.notes?.trim() ?? null,
        },
      });

      if (dto.inspectorId) {
        await this.notifications.create(
          {
            userId: dto.inspectorId,
            type: 'ASSIGNMENT_CREATED',
            title: 'New inspection assigned',
            message: `${inspectionNumber} — ${property.reference} has been assigned to you.`,
            entityType: 'Inspection',
            entityId: inspection.id,
          },
          tx,
        );
      }

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_CREATED',
          entityType: 'Inspection',
          entityId: inspection.id,
          newValue: {
            inspectionNumber,
            loanReference: inspection.loanReference,
            inspectorId: dto.inspectorId ?? null,
          },
          meta,
        },
        tx,
      );

      return inspection;
    });

    return this.findOne(user, created.id);
  }

  /** Assigns or reassigns an inspector. Reassignment requires a reason. */
  async assign(user: TenantContext, id: string, dto: AssignInspectionDto, meta: RequestMetadata) {
    const inspection = await this.loadForTransition(user, id);
    const isReassignment = Boolean(inspection.inspectorId) && inspection.inspectorId !== dto.inspectorId;

    const outcome = evaluateTransition({
      action: isReassignment ? InspectionAction.REASSIGN : InspectionAction.ASSIGN,
      currentStatus: inspection.status,
      userId: user.userId,
      permissions: user.permissions,
      inspectorId: inspection.inspectorId,
      submittedById: null,
      reason: dto.reason,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, outcome.reason);
    }

    const inspector = await this.assertInspector(user, dto.inspectorId);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspection.update({
        where: { id },
        data: {
          inspectorId: inspector.id,
          reviewerId: dto.reviewerId ?? inspection.reviewerId,
          status: outcome.nextStatus,
          priority: dto.priority ?? undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          assignmentNotes: dto.notes?.trim() ?? undefined,
          version: { increment: 1 },
        },
      });

      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId: id,
          fromStatus: inspection.status,
          toStatus: outcome.nextStatus,
          actorId: user.userId,
          comment: dto.reason?.trim() ?? null,
        },
      });

      await this.notifications.create(
        {
          userId: inspector.id,
          type: isReassignment ? 'ASSIGNMENT_CHANGED' : 'ASSIGNMENT_CREATED',
          title: isReassignment ? 'Inspection reassigned to you' : 'New inspection assigned',
          message: `${inspection.inspectionNumber} has been assigned to you.`,
          entityType: 'Inspection',
          entityId: id,
        },
        tx,
      );

      // The previous inspector is told too; silently removing work from
      // somebody's queue is how duplicated effort happens.
      if (isReassignment && inspection.inspectorId) {
        await this.notifications.create(
          {
            userId: inspection.inspectorId,
            type: 'ASSIGNMENT_CHANGED',
            title: 'Inspection reassigned',
            message: `${inspection.inspectionNumber} is no longer assigned to you.`,
            entityType: 'Inspection',
            entityId: id,
          },
          tx,
        );
      }

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: isReassignment ? 'INSPECTION_REASSIGNED' : 'INSPECTION_ASSIGNED',
          entityType: 'Inspection',
          entityId: id,
          previousValue: { inspectorId: inspection.inspectorId },
          newValue: { inspectorId: inspector.id },
          metadata: { reason: dto.reason?.trim() },
          meta,
        },
        tx,
      );
    });

    return this.findOne(user, id);
  }

  async start(user: TenantContext, id: string, meta: RequestMetadata) {
    const inspection = await this.loadForTransition(user, id);

    const outcome = evaluateTransition({
      action: InspectionAction.START,
      currentStatus: inspection.status,
      userId: user.userId,
      permissions: user.permissions,
      inspectorId: inspection.inspectorId,
      submittedById: null,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, outcome.reason);
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspection.update({
        where: { id },
        data: { status: outcome.nextStatus, startedAt: new Date(), version: { increment: 1 } },
      });
      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId: id,
          fromStatus: inspection.status,
          toStatus: outcome.nextStatus,
          actorId: user.userId,
        },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_STARTED',
          entityType: 'Inspection',
          entityId: id,
          meta,
        },
        tx,
      );
    });

    return this.findOne(user, id);
  }

  // -------------------------------------------------------------------------
  // Content capture
  // -------------------------------------------------------------------------

  async saveValues(user: TenantContext, id: string, dto: SaveValuesDto, meta: RequestMetadata) {
    const inspection = await this.assertEditable(user, id, dto.baseVersion);

    await this.prisma.runInTransaction(async (tx) => {
      for (const entry of dto.values) {
        // Confirms the field belongs to this inspection's template, so a client
        // cannot write values against an unrelated template's fields.
        const field = await tx.templateField.findFirst({
          where: { id: entry.fieldId, section: { templateId: inspection.templateId } },
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
          where: { inspectionId_fieldId: { inspectionId: id, fieldId: entry.fieldId } },
          update: data,
          create: { inspectionId: id, fieldId: entry.fieldId, ...data },
        });
      }

      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });
    });

    return this.completeness(user, id);
  }

  async saveAssessment(
    user: TenantContext,
    id: string,
    dto: SaveAssessmentDto,
    meta: RequestMetadata,
  ) {
    await this.assertEditable(user, id, dto.baseVersion);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspectionAssessment.upsert({
        where: { inspectionId_categoryCode: { inspectionId: id, categoryCode: dto.categoryCode } },
        update: {
          rating: dto.rating ?? null,
          condition: dto.condition ?? null,
          notes: dto.notes ?? null,
        },
        create: {
          inspectionId: id,
          categoryCode: dto.categoryCode,
          categoryName: dto.categoryName ?? dto.categoryCode,
          rating: dto.rating ?? null,
          condition: dto.condition ?? null,
          notes: dto.notes ?? null,
        },
      });
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });
    });

    return this.completeness(user, id);
  }

  async saveOwner(user: TenantContext, id: string, dto: SaveOwnerDto, meta: RequestMetadata) {
    await this.assertEditable(user, id, dto.baseVersion);

    const secret = process.env.JWT_SECRET ?? '';

    // The national ID is encrypted before it reaches the database, and indexed
    // through a keyed HMAC so it stays searchable without being readable.
    const nationalIdEnc = dto.nationalId ? encryptField(dto.nationalId.trim(), secret) : null;
    const nationalIdHash = dto.nationalId ? blindIndex(dto.nationalId, secret) : null;

    await this.prisma.runInTransaction(async (tx) => {
      const data = {
        fullName: dto.fullName.trim(),
        nationalIdEnc,
        nationalIdHash,
        phone: dto.phone?.trim() ?? null,
        email: dto.email?.trim().toLowerCase() ?? null,
        occupancyStatus: dto.occupancyStatus ?? null,
        ownershipType: dto.ownershipType ?? null,
      };

      await tx.inspectionOwner.upsert({
        where: { inspectionId: id },
        update: data,
        create: { inspectionId: id, ...data },
      });
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_OWNER_RECORDED',
          entityType: 'Inspection',
          entityId: id,
          // The ID itself is never written to the audit trail in clear text.
          metadata: { fullName: data.fullName, hasNationalId: Boolean(nationalIdEnc) },
          meta,
        },
        tx,
      );
    });

    return this.completeness(user, id);
  }

  async saveValuation(user: TenantContext, id: string, dto: SaveValuationDto, meta: RequestMetadata) {
    await this.assertEditable(user, id, dto.baseVersion);

    await this.prisma.runInTransaction(async (tx) => {
      // Figures are stored exactly as entered. No value is derived here: a
      // silently computed forced-sale figure would shape a lending decision
      // without anybody having authorised the formula.
      const data = {
        currency: dto.currency ?? 'RWF',
        marketValue: dto.marketValue ?? null,
        forcedSaleValue: dto.forcedSaleValue ?? null,
        replacementCost: dto.replacementCost ?? null,
        rentalEstimate: dto.rentalEstimate ?? null,
        comments: dto.comments?.trim() ?? null,
      };

      await tx.inspectionValuation.upsert({
        where: { inspectionId: id },
        update: data,
        create: { inspectionId: id, ...data },
      });
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_VALUATION_RECORDED',
          entityType: 'Inspection',
          entityId: id,
          newValue: data,
          meta,
        },
        tx,
      );
    });

    return this.completeness(user, id);
  }

  async captureLocation(
    user: TenantContext,
    id: string,
    dto: CaptureLocationDto,
    meta: RequestMetadata,
  ) {
    const inspection = await this.assertEditable(user, id, dto.baseVersion);

    if (!isPlausibleCoordinate({ latitude: dto.latitude, longitude: dto.longitude })) {
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        'The coordinates supplied are not a valid location reading.',
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { id: inspection.propertyId },
      select: { latitude: true, longitude: true },
    });

    const proximity = assessProximity(
      { latitude: dto.latitude, longitude: dto.longitude },
      property?.latitude != null && property?.longitude != null
        ? { latitude: Number(property.latitude), longitude: Number(property.longitude) }
        : null,
      dto.accuracyM ?? null,
    );

    const location = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.inspectionLocation.create({
        data: {
          inspectionId: id,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyM: dto.accuracyM ?? null,
          altitudeM: dto.altitudeM ?? null,
          source: dto.source ?? 'GPS',
          // Recorded, not enforced. A mock-location flag is worth showing a
          // reviewer, but blocking on it would reject inspectors whose handsets
          // report it for benign reasons.
          isMocked: dto.isMocked ?? false,
          capturedAt: new Date(dto.capturedAt),
          distanceFromPropertyM: proximity.distanceM,
        },
      });

      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_LOCATION_CAPTURED',
          entityType: 'Inspection',
          entityId: id,
          metadata: {
            distanceFromPropertyM: proximity.distanceM,
            verdict: proximity.verdict,
            isMocked: dto.isMocked ?? false,
          },
          meta,
        },
        tx,
      );

      return created;
    });

    return { location, proximity };
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Submits or resubmits an inspection.
   *
   * Completeness is re-evaluated server-side here regardless of what the client
   * believes. A modified app could skip its own checks; this is the control.
   */
  async submit(user: TenantContext, id: string, meta: RequestMetadata) {
    const inspection = await this.loadForTransition(user, id);

    const action =
      inspection.status === InspectionStatus.CORRECTION_REQUESTED
        ? InspectionAction.RESUBMIT
        : InspectionAction.SUBMIT;

    const outcome = evaluateTransition({
      action,
      currentStatus: inspection.status,
      userId: user.userId,
      permissions: user.permissions,
      inspectorId: inspection.inspectorId,
      submittedById: null,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, outcome.reason);
    }

    const full = await this.loadForCompleteness(user.organizationId, id);
    if (!full) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');

    const completeness = this.computeCompleteness(full);

    if (!completeness.complete) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INCOMPLETE,
        'This inspection cannot be submitted until the outstanding items are resolved.',
        completeness.blockingIssues,
      );
    }

    const round = inspection.submissionCount + 1;

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspection.update({
        where: { id },
        data: {
          status: outcome.nextStatus,
          submittedAt: new Date(),
          submissionCount: round,
          version: { increment: 1 },
        },
      });

      // An immutable copy of exactly what was submitted. This is what makes a
      // later decision traceable to the data the reviewer actually saw, even
      // after the inspector edits and resubmits.
      await tx.inspectionSnapshot.create({
        data: {
          inspectionId: id,
          submissionRound: round,
          payload: JSON.parse(JSON.stringify(this.buildSnapshot(full))),
        },
      });

      // Any outstanding correction request is now answered.
      await tx.correctionRequest.updateMany({
        where: { inspectionId: id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });

      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId: id,
          fromStatus: inspection.status,
          toStatus: outcome.nextStatus,
          actorId: user.userId,
          submissionRound: round,
        },
      });

      const reviewers = await this.resolveReviewers(tx, inspection.organizationId, inspection.reviewerId, inspection.branchId);

      await this.notifications.createMany(
        reviewers.map((reviewerId) => ({
          userId: reviewerId,
          type: 'INSPECTION_SUBMITTED' as const,
          title: 'Inspection submitted for review',
          message: `${inspection.inspectionNumber} is ready for your review.`,
          entityType: 'Inspection',
          entityId: id,
        })),
        tx,
      );

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: action === InspectionAction.RESUBMIT ? 'INSPECTION_RESUBMITTED' : 'INSPECTION_SUBMITTED',
          entityType: 'Inspection',
          entityId: id,
          metadata: { submissionRound: round, completeness: completeness.percentage },
          meta,
        },
        tx,
      );
    });

    return this.findOne(user, id);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildOrderBy(
    sortBy?: string,
    sortDir?: 'asc' | 'desc',
  ): Prisma.InspectionOrderByWithRelationInput {
    const direction = sortDir ?? 'desc';
    // Whitelisted: an unchecked sort field would let a caller order by, and so
    // infer, columns they are not permitted to read.
    switch (sortBy) {
      case 'inspectionNumber':
        return { inspectionNumber: direction };
      case 'submittedAt':
        return { submittedAt: direction };
      case 'dueDate':
        return { dueDate: direction };
      case 'priority':
        return { priority: direction };
      case 'status':
        return { status: direction };
      default:
        return { createdAt: direction };
    }
  }

  private async loadForTransition(user: TenantContext, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        propertyId: true,
        templateId: true,
        inspectionNumber: true,
        status: true,
        inspectorId: true,
        reviewerId: true,
        submissionCount: true,
        version: true,
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

  /**
   * Confirms the caller may edit, and that they are not writing over somebody
   * else's newer change.
   */
  private async assertEditable(user: TenantContext, id: string, baseVersion?: number) {
    const inspection = await this.loadForTransition(user, id);

    if (inspection.inspectorId !== user.userId) {
      throw new ForbiddenError(
        'Only the assigned inspector can fill in this inspection.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    if (!isEditable(inspection.status)) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INVALID_TRANSITION,
        `An inspection that is ${inspection.status.replace(/_/g, ' ').toLowerCase()} can no longer be edited.`,
      );
    }

    if (baseVersion !== undefined && baseVersion < inspection.version) {
      throw new ConflictError(
        ErrorCode.INSPECTION_STALE_VERSION,
        'This inspection changed since your device last synchronised. Refresh before saving again.',
        { serverVersion: inspection.version },
      );
    }

    return inspection;
  }

  private async assertInspector(user: TenantContext, inspectorId: string) {
    const inspector = await this.prisma.user.findFirst({
      where: {
        id: inspectorId,
        organizationId: user.organizationId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } } },
      },
    });

    if (!inspector) {
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'The chosen inspector was not found or is not active.');
    }

    // Assigning fieldwork to somebody who cannot fill it in would create an
    // inspection nobody is able to progress.
    const canInspect = inspector.userRoles.some((ur) =>
      ur.role.rolePermissions.some((rp) => rp.permission.code === 'inspections.write'),
    );

    if (!canInspect) {
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        'That user does not hold the permission required to carry out inspections.',
      );
    }

    return inspector;
  }

  private async nextInspectionNumber(
    tx: PrismaTransactionClient,
    organizationId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INS-${year}-`;

    // Derived from the highest existing number rather than a count, so deleting
    // a record cannot cause the next one to collide. The unique constraint on
    // (organizationId, inspectionNumber) is the real guarantee.
    const last = await tx.inspection.findFirst({
      where: { organizationId, inspectionNumber: { startsWith: prefix } },
      orderBy: { inspectionNumber: 'desc' },
      select: { inspectionNumber: true },
    });

    const sequence = last ? Number(last.inspectionNumber.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(sequence).padStart(6, '0')}`;
  }

  private loadForCompleteness(organizationId: string, id: string) {
    return this.prisma.inspection.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        owner: true,
        valuation: true,
        assessments: true,
        values: true,
        locations: true,
        photos: { where: { deletedAt: null }, select: { category: true } },
        template: {
          include: {
            sections: { orderBy: { sortOrder: 'asc' }, include: { fields: true } },
            photoRules: true,
          },
        },
      },
    });
  }

  /**
   * Maps stored records onto the completeness engine's input.
   *
   * The parameter is typed against what Prisma actually returns. An earlier
   * version declared `type: never` and `category: never` here, which can never
   * be satisfied — nothing is assignable *to* never — so every call site failed
   * to compile. The enum types belong in the signature; `as never` is only ever
   * safe in an argument position, not a parameter declaration.
   *
   * Extra properties on the incoming rows (sortOrder, sectionId, options and so
   * on) are accepted: TypeScript's structural typing allows a wider object to
   * satisfy a narrower shape, so both findOne and loadForCompleteness can be
   * passed straight in.
   */
  private computeCompleteness(inspection: {
    template: {
      sections: Array<{
        code: string;
        name: string;
        isAssessment: boolean;
        fields: Array<{
          id: string;
          code: string;
          label: string;
          type: FieldType;
          required: boolean;
          validation: Prisma.JsonValue;
        }>;
      }>;
      photoRules: Array<{
        category: PhotoCategory;
        minCount: number;
        required: boolean;
      }>;
    };
    values: Array<{
      fieldId: string;
      valueText: string | null;
      valueNumber: Prisma.Decimal | null;
      valueDate: Date | null;
      valueBool: boolean | null;
      valueJson: Prisma.JsonValue;
    }>;
    assessments: Array<{
      categoryCode: string;
      categoryName: string;
      rating: number | null;
      condition: ConditionStatus | null;
    }>;
    photos: Array<{ category: PhotoCategory }>;
    owner: unknown;
    valuation: unknown;
    locations: unknown[];
  }): CompletenessResult {
    const photoCountsByCategory: Record<string, number> = {};
    for (const photo of inspection.photos) {
      photoCountsByCategory[photo.category] = (photoCountsByCategory[photo.category] ?? 0) + 1;
    }

    return evaluateCompleteness({
      sections: inspection.template.sections.map((section) => ({
        code: section.code,
        name: section.name,
        isAssessment: section.isAssessment,
        fields: section.fields.map((field) => ({
          id: field.id,
          code: field.code,
          label: field.label,
          type: field.type,
          required: field.required,
          // Stored as JSON because validation rules are template-defined and
          // therefore not known to the schema. The cast is narrow and local.
          validation: (field.validation ?? null) as FieldValidation | null,
        })),
      })),
      photoRules: inspection.template.photoRules.map((rule) => ({
        category: rule.category,
        minCount: rule.minCount,
        required: rule.required,
      })),
      values: inspection.values.map((value) => ({
        fieldId: value.fieldId,
        valueText: value.valueText,
        // Prisma returns Decimal for money and measurements; the engine compares
        // against plain numbers, so the conversion happens once, here.
        valueNumber: value.valueNumber === null ? null : Number(value.valueNumber),
        valueDate: value.valueDate,
        valueBool: value.valueBool,
        valueJson: value.valueJson,
      })),
      assessments: inspection.assessments.map((assessment) => ({
        categoryCode: assessment.categoryCode,
        categoryName: assessment.categoryName,
        rating: assessment.rating,
        condition: assessment.condition,
      })),
      photoCountsByCategory,
      hasOwner: Boolean(inspection.owner),
      hasValuation: Boolean(inspection.valuation),
      hasLocation: inspection.locations.length > 0,
    });
  }

  private buildSnapshot(inspection: Record<string, unknown>) {
    // Deliberately excludes the template: it is versioned separately and
    // duplicating it in every snapshot would bloat the table considerably.
    const { template: _template, ...rest } = inspection;
    return rest;
  }

  /**
   * Works out who should be told that an inspection is waiting.
   *
   * A named reviewer takes precedence. Otherwise every user in the organization
   * holding reviews.decide is notified, so work is never left unseen because
   * nobody was explicitly assigned.
   */
  private async resolveReviewers(
    tx: PrismaTransactionClient,
    organizationId: string,
    namedReviewerId: string | null,
    branchId: string,
  ): Promise<string[]> {
    if (namedReviewerId) return [namedReviewerId];

    const reviewers = await tx.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        OR: [{ branchId }, { branchScope: 'ALL_BRANCHES' }],
        userRoles: {
          some: {
            role: { rolePermissions: { some: { permission: { code: 'reviews.decide' } } } },
          },
        },
      },
      select: { id: true },
      take: 25,
    });

    return reviewers.map((r) => r.id);
  }
}
