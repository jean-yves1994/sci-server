import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { ReviewerMapService } from './reviewer-map.service';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewerMapController {
  constructor(private readonly maps: ReviewerMapService) {}

  @Get('inspections/:id/review/map')
  @RequirePermissions('reviews.read')
  @ApiOperation({ summary: 'Get the professional review map image' })
  get(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.maps.get(user, id);
  }

  @Post('inspections/:id/review/map')
  @RequirePermissions('reviews.decide')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the professional review map image' })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string },
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.maps.upload(user, id, file, meta);
  }

  @Delete('inspections/:id/review/map')
  @RequirePermissions('reviews.decide')
  @ApiOperation({ summary: 'Remove the professional review map image' })
  remove(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ClientMeta() meta: RequestMetadata) {
    return this.maps.remove(user, id, meta);
  }
}
