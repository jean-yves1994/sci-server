import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import {
  AssignInspectionDto, CaptureLocationDto, CreateInspectionDto, InspectionQueryDto,
  SaveAssessmentDto, SaveOwnerDto, SaveValuationDto, SaveValuesDto,
} from './dto/inspection.dto';
import { InspectionsService } from './inspections.service';

@ApiTags('Inspections')
@ApiBearerAuth()
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'List inspections with search, filtering, sorting and pagination' })
  list(@CurrentUser() user: TenantContext, @Query() query: InspectionQueryDto) {
    return this.inspections.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'Full inspection detail including completeness and GPS assessment' })
  findOne(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.findOne(user, id);
  }

  @Get(':id/completeness')
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'Review summary: progress, missing fields, missing photographs' })
  completeness(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspections.completeness(user, id);
  }

  @Post()
  @RequirePermissions('inspections.create')
  @ApiOperation({ summary: 'Raise an inspection against a property' })
  create(
    @CurrentUser() user: TenantContext,
    @Body() dto: CreateInspectionDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.create(user, dto, meta);
  }

  @Post(':id/assign')
  @RequirePermissions('inspections.assign')
  @ApiOperation({ summary: 'Assign or reassign an inspector' })
  assign(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignInspectionDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.assign(user, id, dto, meta);
  }

  @Post(':id/start')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Start work on an assigned inspection' })
  start(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.start(user, id, meta);
  }

  @Patch(':id/values')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Save template field answers' })
  saveValues(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveValuesDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.saveValues(user, id, dto, meta);
  }

  @Patch(':id/assessments')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Record a condition assessment' })
  saveAssessment(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAssessmentDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.saveAssessment(user, id, dto, meta);
  }

  @Patch(':id/owner')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Record owner information' })
  saveOwner(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveOwnerDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.saveOwner(user, id, dto, meta);
  }

  @Patch(':id/valuation')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Record valuation figures' })
  saveValuation(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveValuationDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.saveValuation(user, id, dto, meta);
  }

  @Post(':id/location')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Capture a GPS reading; distance is computed server-side' })
  captureLocation(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaptureLocationDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.captureLocation(user, id, dto, meta);
  }

  @Post(':id/submit')
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Submit or resubmit for review; completeness is re-checked' })
  submit(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.inspections.submit(user, id, meta);
  }
}
