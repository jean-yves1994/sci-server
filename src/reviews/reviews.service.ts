import { Injectable, Logger } from '@nestjs/common';
import { CommentType, InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { InspectionAction, evaluateTransition } from '../inspections/domain/inspection-state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService } from '../reports/reports.service';
import { ApproveDto, CommentDto, DecisionDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  /** Claims an inspection for review, so two reviewers do not duplicate work. */
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
    return this.decide(
      user,
      id,
      InspectionAction.REQUEST_CORRECTION,
      dto.reason,
      meta,
      dto.baseVersion,
      dto.targetSections,
    );
  }

  /**
   * Applies a review decision.
   *
   * Every outcome shares this path so the permission check, the
   * separation-of-duties check, the status change, the written reason, the
   * notification and the audit record can never drift apart between them.
   */
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

    // Optimistic concurrency: this is the §44 scenario where a reviewer opened
    // the page, the inspector resubmitted, and the reviewer then acts on what
    // they saw. Refusing is the only safe answer — approving stale content
    // would attach an approval to data nobody reviewed.
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
      // The inspector who did the work is the one who submitted it, so they are
      // barred from signing it off.
      submittedById: inspection.inspectorId,
      reason,
    });

    if (!outcome.allowed) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, outcome.reason);
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

    // Report generation runs after the decision commits, not inside it. PDF
    // rendering is slow and touches object storage; holding a database
    // transaction open across it would risk timeouts on the approval itself.
    if (action === InspectionAction.APPROVE) {
      try {
        await this.reports.generate(user, id, meta);
      } catch (error) {
        // The approval stands even if rendering fails — it can be retried from
        // the reports module — but the failure is logged loudly.
        this.logger.error(
          `Approved ${inspection.inspectionNumber} but report generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { id, status: outcome.nextStatus };
  }

  async addComment(user: TenantContext, id: string, dto: CommentDto, meta: RequestMetadata) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true, inspectorId: true, inspectionNumber: true },
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

    const comment = await this.prisma.inspectionComment.create({
      data: {
        inspectionId: id,
        authorId: user.userId,
        body: dto.body.trim(),
        type: CommentType.REVIEWER_NOTE,
      },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
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

  private notificationMessageFor(
    action: InspectionAction,
    inspectionNumber: string,
    reason?: string,
  ): string {
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
