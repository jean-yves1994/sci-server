import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { InspectionQueryDto, SaveValuationDto } from '../inspections/dto/inspection.dto';
import { InspectionsService } from '../inspections/inspections.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApproveDto, CommentDto, DecisionDto, ReviewerAdjustmentDto, ReviewerConclusionDto, ReviewerRiskDto } from './dto/review.dto';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InspectionStatus } from '@prisma/client';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly inspections: InspectionsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('reviews/queue')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Inspections awaiting a decision, oldest submission first' })
  queue(@CurrentUser() user: TenantContext, @Query() query: InspectionQueryDto) { return this.inspections.reviewQueue(user, query); }

  @Get('inspections/:id/review')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Get professional review workspace data and adjustment history' })
  async reviewWorkspace(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const workspace = await this.reviews.reviewWorkspace(user, id);
    const reviewerValuation = await this.prisma.$queryRaw<Array<{
      id: string;
      inspectionId: string;
      reviewerId: string;
      currency: string;
      marketValue: unknown;
      forcedSaleValue: unknown;
      replacementCost: unknown;
      rentalEstimate: unknown;
      comments: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>>`
      SELECT id,
             inspection_id AS "inspectionId",
             reviewer_id AS "reviewerId",
             currency,
             market_value AS "marketValue",
             forced_sale_value AS "forcedSaleValue",
             replacement_cost AS "replacementCost",
             rental_estimate AS "rentalEstimate",
             comments,
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM reviewer_valuations
      WHERE inspection_id = ${id}
      LIMIT 1
    `;

    // The professional review workspace must expose the same status history
    // expected by the web review panel. getReviewable() intentionally keeps
    // its query focused, so load the audit/status timeline explicitly here.
    const statusEvents = await this.prisma.inspectionStatusEvent.findMany({
      where: { inspectionId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    return {
      ...workspace,
      inspection: {
        ...workspace.inspection,
        statusEvents,
      },
      reviewerValuation: reviewerValuation[0] ?? null,
    };
  }

  @Post('inspections/:id/begin-review')
  @RequirePermissions('reviews.decide')
  beginReview(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ClientMeta() meta: RequestMetadata) { return this.reviews.beginReview(user, id, meta); }

  @Post('inspections/:id/review/adjustments')
  @RequirePermissions('reviews.decide')
  addAdjustment(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewerAdjustmentDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.addAdjustment(user, id, dto, meta); }

  @Patch('inspections/:id/review/valuation')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Set the professional valuation and valuation comments during review' })
  async saveReviewerValuation(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveValuationDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true, status: true, version: true, reviewerId: true },
    });

    if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    if (!canAccessBranch(user, inspection.branchId)) {
      throw new ForbiddenError('This inspection belongs to a branch you do not have access to.', ErrorCode.AUTH_FORBIDDEN);
    }
    if (inspection.reviewerId && inspection.reviewerId !== user.userId) {
      throw new ForbiddenError('Only the reviewer who claimed this inspection can modify the professional valuation.', ErrorCode.AUTH_FORBIDDEN);
    }
    if (!inspection.reviewerId) {
      throw new ForbiddenError('Claim the inspection for review before entering the professional valuation.', ErrorCode.AUTH_FORBIDDEN);
    }

    const editableStatuses: InspectionStatus[] = [
      InspectionStatus.UNDER_REVIEW,
      InspectionStatus.SUBMITTED,
      InspectionStatus.RESUBMITTED,
    ];
    if (!editableStatuses.includes(inspection.status)) {
      throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, 'Professional valuation is only editable while the inspection is awaiting review.');
    }
    if (dto.baseVersion !== undefined && dto.baseVersion < inspection.version) {
      throw new ConflictError(
        ErrorCode.INSPECTION_STALE_VERSION,
        'This inspection changed while you were reviewing it. Reload before making changes.',
        { serverVersion: inspection.version },
      );
    }

    const valuation = await this.prisma.runInTransaction(async (tx) => {
      const now = new Date();
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM reviewer_valuations WHERE inspection_id = ${id} LIMIT 1
      `;

      let result: Record<string, unknown>[];
      if (existing[0]) {
        result = await tx.$queryRaw<Array<Record<string, unknown>>>`
          UPDATE reviewer_valuations
          SET reviewer_id = ${user.userId},
              currency = ${dto.currency?.trim().toUpperCase() || 'RWF'},
              market_value = ${dto.marketValue ?? null},
              forced_sale_value = ${dto.forcedSaleValue ?? null},
              replacement_cost = ${dto.replacementCost ?? null},
              rental_estimate = ${dto.rentalEstimate ?? null},
              comments = ${dto.comments?.trim() || null},
              updated_at = ${now}
          WHERE inspection_id = ${id}
          RETURNING id,
                    inspection_id AS "inspectionId",
                    reviewer_id AS "reviewerId",
                    currency,
                    market_value AS "marketValue",
                    forced_sale_value AS "forcedSaleValue",
                    replacement_cost AS "replacementCost",
                    rental_estimate AS "rentalEstimate",
                    comments,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
        `;
      } else {
        result = await tx.$queryRaw<Array<Record<string, unknown>>>`
          INSERT INTO reviewer_valuations (
            inspection_id, reviewer_id, currency, market_value, forced_sale_value,
            replacement_cost, rental_estimate, comments, created_at, updated_at
          ) VALUES (
            ${id}, ${user.userId}, ${dto.currency?.trim().toUpperCase() || 'RWF'},
            ${dto.marketValue ?? null}, ${dto.forcedSaleValue ?? null}, ${dto.replacementCost ?? null}, ${dto.rentalEstimate ?? null},
            ${dto.comments?.trim() || null}, ${now}, ${now}
          )
          RETURNING id,
                    inspection_id AS "inspectionId",
                    reviewer_id AS "reviewerId",
                    currency,
                    market_value AS "marketValue",
                    forced_sale_value AS "forcedSaleValue",
                    replacement_cost AS "replacementCost",
                    rental_estimate AS "rentalEstimate",
                    comments,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
        `;
      }

      await tx.$executeRaw`
        UPDATE inspections
        SET "reviewerAdjustedAt" = CURRENT_TIMESTAMP,
            version = version + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${id}
      `;

      await this.audit.record({
        organizationId: user.organizationId,
        userId: user.userId,
        action: 'REVIEWER_VALUATION_UPDATED',
        entityType: 'Inspection',
        entityId: id,
        newValue: {
          currency: dto.currency?.trim().toUpperCase() || 'RWF',
          marketValue: dto.marketValue ?? null,
          forcedSaleValue: dto.forcedSaleValue ?? null,
          replacementCost: dto.replacementCost ?? null,
          rentalEstimate: dto.rentalEstimate ?? null,
          comments: dto.comments?.trim() || null,
        },
        meta,
      }, tx);

      return result[0];
    });

    return valuation;
  }

  @Patch('inspections/:id/review/risk')
  @RequirePermissions('reviews.decide')
  setRisk(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewerRiskDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.setRisk(user, id, dto, meta); }

  @Patch('inspections/:id/review/conclusion')
  @RequirePermissions('reviews.decide')
  setConclusion(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewerConclusionDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.setConclusion(user, id, dto, meta); }

  @Post('inspections/:id/approve')
  @RequirePermissions('reviews.decide')
  approve(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.approve(user, id, dto, meta); }

  @Post('inspections/:id/reject')
  @RequirePermissions('reviews.decide')
  reject(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.reject(user, id, dto, meta); }

  @Post('inspections/:id/request-correction')
  @RequirePermissions('reviews.decide')
  requestCorrection(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.requestCorrection(user, id, dto, meta); }

  @Post('inspections/:id/comments')
  @RequirePermissions('inspections.read')
  addComment(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.addComment(user, id, dto, meta); }
}
