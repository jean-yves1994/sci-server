import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { InspectionQueryDto } from '../inspections/dto/inspection.dto';
import { InspectionsService } from '../inspections/inspections.service';
import { ApproveDto, CommentDto, DecisionDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly inspections: InspectionsService,
  ) {}

  @Get('reviews/queue')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Inspections awaiting a decision, oldest submission first' })
  queue(@CurrentUser() user: TenantContext, @Query() query: InspectionQueryDto) {
    return this.inspections.reviewQueue(user, query);
  }

  @Post('inspections/:id/begin-review')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Claim an inspection for review' })
  beginReview(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reviews.beginReview(user, id, meta);
  }

  @Post('inspections/:id/approve')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Approve an inspection and generate the official report' })
  approve(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reviews.approve(user, id, dto, meta);
  }

  @Post('inspections/:id/reject')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Reject an inspection. A written reason is mandatory.' })
  reject(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reviews.reject(user, id, dto, meta);
  }

  @Post('inspections/:id/request-correction')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Return an inspection to the inspector for correction' })
  requestCorrection(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reviews.requestCorrection(user, id, dto, meta);
  }

  @Post('inspections/:id/comments')
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'Add a comment to an inspection' })
  addComment(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.reviews.addComment(user, id, dto, meta);
  }
}
