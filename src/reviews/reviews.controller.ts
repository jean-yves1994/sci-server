import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { InspectionQueryDto } from '../inspections/dto/inspection.dto';
import { InspectionsService } from '../inspections/inspections.service';
import { ApproveDto, CommentDto, DecisionDto, ReviewerAdjustmentDto, ReviewerConclusionDto, ReviewerRiskDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService, private readonly inspections: InspectionsService) {}

  @Get('reviews/queue')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Inspections awaiting a decision, oldest submission first' })
  queue(@CurrentUser() user: TenantContext, @Query() query: InspectionQueryDto) { return this.inspections.reviewQueue(user, query); }

  @Get('inspections/:id/review')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Get professional review workspace data and adjustment history' })
  reviewWorkspace(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) { return this.reviews.reviewWorkspace(user, id); }

  @Post('inspections/:id/begin-review')
  @RequirePermissions('reviews.decide')
  beginReview(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ClientMeta() meta: RequestMetadata) { return this.reviews.beginReview(user, id, meta); }

  @Post('inspections/:id/review/adjustments')
  @RequirePermissions('reviews.decide')
  addAdjustment(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewerAdjustmentDto, @ClientMeta() meta: RequestMetadata) { return this.reviews.addAdjustment(user, id, dto, meta); }

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
