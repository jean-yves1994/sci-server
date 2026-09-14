import { Injectable, Logger } from '@nestjs/common';
import { CommentType, InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { InspectionAction, evaluateTransition } from '../inspections/domain/inspection-state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../reports/reports.service';
import { ApproveDto, CommentDto, DecisionDto, ReviewerAdjustmentDto, ReviewerConclusionDto, ReviewerRiskDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  beginReview(user: TenantContext, id: string, meta: RequestMetadata) {
    return this.decide(user, id, InspectionAction.BEGIN_REVIEW, undefined, meta);
  }

  approve(user: TenantContext, id: string, dto: ApproveDto, meta: RequestMetadata) {
    return this.decide(user, id, InspectionAction.APPROVE, dto.note, meta, dto.baseVersion);
  }

  reject(user: TenantContext, id: string, dto: DecisionDto, meta: RequestMetadata) {
    return this.decide(user, id, InspectionAction.REJECT, dto.reason, meta, dto.baseVersion);
  }

  requestCorrection(user: TenantContext, id: string, dto: DecisionDto, meta: RequestMetadata) {
    return this.decide(user, id, InspectionAction.REQUEST_CORRECTION, dto.reason, meta, dto.baseVersion, dto.targetSections);
  }

  private async getReviewable(user: TenantContext, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        status: true,
        version: true,
        inspectorId: true,
        reviewerId: true,
        inspectionNumber: true,
        submissionCount: true,
        clientName: true,
        loanReference: true,
        property: {
          select: {
            id: true,
            reference: true,
            name: true,
            propertyType: true,
            addressLine: true,
            plotNumber: true,
            titleNumber: true,
            latitude: true,
            longitude: true,
          },
        },
        valuation: true,
        owner: true,
        values: {
          include: {
            field: {
              include: {
                section: true,
              },
            },
          },
        },
        assessments: true,
        locations: {
          orderBy: {
            capturedAt: 'desc',
          },
        },
        photos: {
          where: {
            deletedAt: null,
          },
          include: {
            capturedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        comments: {
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        corrections: {
          include: {
            requestedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        reports: {
          orderBy: {
            generatedAt: 'desc',
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

    return inspection;
  }

  async reviewWorkspace(user: TenantContext, id: string) {
    const inspection = await this.getReviewable(user, id);
    const adjustments = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ra.id, ra.field_code AS "fieldCode", ra.original_value AS "originalValue", ra.adjusted_value AS "adjustedValue", ra.reason, ra.created_at AS "createdAt",
             u.id AS "reviewerId", u."firstName" AS "reviewerFirstName", u."lastName" AS "reviewerLastName"
      FROM reviewer_adjustments ra JOIN users u ON u.id = ra.reviewer_id
      WHERE ra.inspection_id = ${id} ORDER BY ra.created_at ASC`;
    const reviewMeta = await this.prisma.$queryRaw<Array<{ reviewerRisk: unknown; reviewerConclusion: string | null; reviewerAdjustedAt: Date | null }>>`
      SELECT "reviewerRisk", "reviewerConclusion", "reviewerAdjustedAt" FROM inspections WHERE id = ${id}`;
    return {
      inspection: {
        ...inspection,
        reviewerRisk: reviewMeta[0]?.reviewerRisk ?? null,
        reviewerConclusion: reviewMeta[0]?.reviewerConclusion ?? null,
        reviewerAdjustedAt: reviewMeta[0]?.reviewerAdjustedAt ?? null,
      },
      adjustments,
    };
  }

  private async assertReviewerCanEdit(user: TenantContext, id: string, baseVersion?: number) {
    const inspection = await this.getReviewable(user, id);

    if (inspection.reviewerId && inspection.reviewerId !== user.userId) {
      throw new ForbiddenError(
        'Only the reviewer who claimed this inspection can modify the professional review.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    const reviewableStatuses: InspectionStatus[] = [
      InspectionStatus.UNDER_REVIEW,
      InspectionStatus.SUBMITTED,
      InspectionStatus.RESUBMITTED,
    ];

    if (!reviewableStatuses.includes(inspection.status)) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INVALID_TRANSITION,
        'Professional review is only editable while the inspection is awaiting review.',
      );
    }

    if (baseVersion !== undefined && baseVersion < inspection.version) {
      throw new ConflictError(
        ErrorCode.INSPECTION_STALE_VERSION,
        'This inspection changed while you were reviewing it. Reload before making changes.',
        { serverVersion: inspection.version },
      );
    }

    return inspection;
  }

  async addAdjustment(user: TenantContext, id: string, dto: ReviewerAdjustmentDto, meta: RequestMetadata) {
    const inspection = await this.assertReviewerCanEdit(user, id, dto.baseVersion);
    const fieldCode = dto.fieldCode.trim();
    if (!fieldCode) throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Field code is required.');
    const existing = inspection.values.find((v) => v.field.code === fieldCode);
    if (!existing) throw new BadRequestError(ErrorCode.VALIDATION_ERROR, `Cannot adjust unknown inspection field: ${fieldCode}.`);

    const original = {
      text: existing.valueText,
      number: existing.valueNumber?.toString(),
      date: existing.valueDate,
      bool: existing.valueBool,
      json: existing.valueJson,
    };

    const created = await this.prisma.runInTransaction(async (tx) => {
      const row = await tx.$queryRaw<Array<Record<string, unknown>>>`
        INSERT INTO reviewer_adjustments (inspection_id, reviewer_id, field_code, original_value, adjusted_value, reason)
        VALUES (${id}, ${user.userId}, ${fieldCode}, ${JSON.stringify(original)}::jsonb, ${JSON.stringify(dto.adjustedValue)}::jsonb, ${dto.reason.trim()})
        RETURNING id, field_code AS "fieldCode", original_value AS "originalValue", adjusted_value AS "adjustedValue", reason, created_at AS "createdAt"`;
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'REVIEWER_ADJUSTMENT_CREATED',
          entityType: 'Inspection',
          entityId: id,
          previousValue: original,
          newValue: dto.adjustedValue,
          metadata: { fieldCode, reason: dto.reason.trim() },
          meta,
        },
        tx,
      );
      return row[0];
    });

    return created;
  }

  async setRisk(user: TenantContext, id: string, dto: ReviewerRiskDto, meta: RequestMetadata) {
    await this.assertReviewerCanEdit(user, id, dto.baseVersion);
    const level = dto.level.trim().toUpperCase();
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(level)) {
      throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Risk must be LOW, MEDIUM, or HIGH.');
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`UPDATE inspections SET "reviewerRisk" = ${JSON.stringify({ level, comments: dto.comments?.trim() ?? null })}::jsonb, "reviewerAdjustedAt" = CURRENT_TIMESTAMP, version = version + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${id}`;
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'REVIEWER_RISK_UPDATED',
          entityType: 'Inspection',
          entityId: id,
          newValue: { level, comments: dto.comments?.trim() ?? null },
          meta,
        },
        tx,
      );
    });

    return { id, risk: { level, comments: dto.comments?.trim() ?? null } };
  }

  async setConclusion(user: TenantContext, id: string, dto: ReviewerConclusionDto, meta: RequestMetadata) {
    await this.assertReviewerCanEdit(user, id, dto.baseVersion);
    const conclusion = dto.conclusion.trim();

    await this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`UPDATE inspections SET "reviewerConclusion" = ${conclusion}, "reviewerAdjustedAt" = CURRENT_TIMESTAMP, version = version + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${id}`;
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'REVIEWER_CONCLUSION_UPDATED',
          entityType: 'Inspection',
          entityId: id,
          newValue: { conclusion },
          meta,
        },
        tx,
      );
    });

    return { id, conclusion };
  }

  private async decide(
    user: TenantContext,
    id: string,
    action: InspectionAction,
    reason: string | undefined,
    meta: RequestMetadata,
    baseVersion?: number,
    targetSections?: string[],
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        status: true,
        version: true,
        inspectorId: true,
        inspectionNumber: true,
        submissionCount: true,
        reviewerId: true,
      },
    });

    if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    if (!canAccessBranch(user, inspection.branchId)) {
      throw new ForbiddenError('This inspection belongs to a branch you do not have access to.', ErrorCode.AUTH_FORBIDDEN);
    }
    if (baseVersion !== undefined && baseVersion < inspection.version) {
      throw new ConflictError(
        ErrorCode.INSPECTION_STALE_VERSION,
        'This inspection was updated while you were reviewing it. Reload before deciding.',
        { serverVersion: inspection.version },
      );
    }

    const outcome = evaluateTransition({
      action,
      currentStatus: inspection.status,
      userId: user.userId,
      permissions: user.permissions,
      inspectorId: inspection.inspectorId,
      submittedById: inspection.inspectorId,
      reason,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, outcome.reason);
    }

    if (action === InspectionAction.APPROVE) {
      const metaRow = await this.prisma.$queryRaw<Array<{ reviewerRisk: { level?: string } | null; reviewerConclusion: string | null }>>`
        SELECT "reviewerRisk", "reviewerConclusion" FROM inspections WHERE id = ${id}`;
      const review = metaRow[0];
      const riskLevel = review?.reviewerRisk?.level?.toUpperCase();
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(riskLevel ?? '')) {
        throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Set the professional risk classification before approving the inspection.');
      }
      if (!review?.reviewerConclusion?.trim()) {
        throw new BadRequestError(ErrorCode.VALIDATION_ERROR, 'Enter the professional reviewer conclusion before approving the inspection.');
      }
      if (!inspection.reviewerId || inspection.reviewerId !== user.userId) {
        throw new ForbiddenError('A professional reviewer must be assigned before approval.', ErrorCode.AUTH_FORBIDDEN);
      }
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspection.update({
        where: { id },
        data: {
          status: outcome.nextStatus,
          reviewerId: user.userId,
          reviewedAt: new Date(),
          approvedAt: action === InspectionAction.APPROVE ? new Date() : undefined,
          version: { increment: 1 },
        },
      });
      if (reason?.trim()) {
        await tx.inspectionComment.create({
          data: {
            inspectionId: id,
            authorId: user.userId,
            body: reason.trim(),
            type: this.commentTypeFor(action),
          },
        });
      }
      if (action === InspectionAction.REQUEST_CORRECTION) {
        await tx.correctionRequest.create({
          data: {
            inspectionId: id,
            requestedById: user.userId,
            reason: reason!.trim(),
            targetSections: targetSections ?? undefined,
            submissionRound: inspection.submissionCount,
          },
        });
      }
      await tx.inspectionStatusEvent.create({
        data: {
          inspectionId: id,
          fromStatus: inspection.status,
          toStatus: outcome.nextStatus,
          actorId: user.userId,
          comment: reason?.trim() ?? null,
          submissionRound: inspection.submissionCount,
        },
      });
      if (inspection.inspectorId && action !== InspectionAction.BEGIN_REVIEW) {
        await this.notifications.create(
          {
            userId: inspection.inspectorId,
            type: this.notificationTypeFor(action),
            title: this.notificationTitleFor(action),
            message: this.notificationMessageFor(action, inspection.inspectionNumber, reason),
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
          action: `INSPECTION_${action}`,
          entityType: 'Inspection',
          entityId: id,
          previousValue: { status: inspection.status },
          newValue: { status: outcome.nextStatus },
          metadata: {
            inspectionNumber: inspection.inspectionNumber,
            reason: reason?.trim(),
            submissionRound: inspection.submissionCount,
          },
          meta,
        },
        tx,
      );
    });

    if (action === InspectionAction.APPROVE) {
      try {
        await this.reports.generate(user, id, meta);
      } catch (error) {
        this.logger.error(
          `Approved ${inspection.inspectionNumber} but report generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { id, status: outcome.nextStatus };
  }

  async addComment(user: TenantContext, id: string, dto: CommentDto, meta: RequestMetadata) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    if (!canAccessBranch(user, inspection.branchId)) {
      throw new ForbiddenError('This inspection belongs to a branch you do not have access to.', ErrorCode.AUTH_FORBIDDEN);
    }
    const comment = await this.prisma.inspectionComment.create({
      data: {
        inspectionId: id,
        authorId: user.userId,
        body: dto.body.trim(),
        type: CommentType.REVIEWER_NOTE,
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.userId,
      action: 'INSPECTION_COMMENT_ADDED',
      entityType: 'Inspection',
      entityId: id,
      meta,
    });
    return comment;
  }

  private commentTypeFor(action: InspectionAction): CommentType {
    switch (action) {
      case InspectionAction.REJECT:
        return CommentType.REJECTION_REASON;
      case InspectionAction.REQUEST_CORRECTION:
        return CommentType.CORRECTION_REQUEST;
      case InspectionAction.APPROVE:
        return CommentType.APPROVAL_NOTE;
      default:
        return CommentType.REVIEWER_NOTE;
    }
  }

  private notificationTypeFor(action: InspectionAction) {
    switch (action) {
      case InspectionAction.APPROVE:
        return 'INSPECTION_APPROVED' as const;
      case InspectionAction.REJECT:
        return 'INSPECTION_REJECTED' as const;
      case InspectionAction.REQUEST_CORRECTION:
        return 'CORRECTION_REQUESTED' as const;
      default:
        return 'SYSTEM_ALERT' as const;
    }
  }

  private notificationTitleFor(action: InspectionAction): string {
    switch (action) {
      case InspectionAction.APPROVE:
        return 'Inspection approved';
      case InspectionAction.REJECT:
        return 'Inspection rejected';
      case InspectionAction.REQUEST_CORRECTION:
        return 'Corrections requested';
      default:
        return 'Inspection updated';
    }
  }

  private notificationMessageFor(action: InspectionAction, inspectionNumber: string, reason?: string): string {
    switch (action) {
      case InspectionAction.APPROVE:
        return `${inspectionNumber} has been approved. The official report is being prepared.`;
      case InspectionAction.REJECT:
        return `${inspectionNumber} was rejected: ${reason ?? 'no reason recorded'}`;
      case InspectionAction.REQUEST_CORRECTION:
        return `${inspectionNumber} needs corrections: ${reason ?? 'see the reviewer notes'}`;
      default:
        return `${inspectionNumber} has been updated.`;
    }
  }
}
