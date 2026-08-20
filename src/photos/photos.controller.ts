import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMeta, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { UploadPhotoDto } from './dto/photo.dto';
import { PhotosService } from './photos.service';

@ApiTags('Photos')
@ApiBearerAuth()
@Controller()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get('inspections/:id/photos')
  @RequirePermissions('inspections.read')
  @ApiOperation({ summary: 'List photographs with short-lived signed URLs' })
  list(@CurrentUser() user: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.photos.list(user, id);
  }

  @Post('inspections/:id/photos')
  @RequirePermissions('inspections.write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a photograph; type is verified by magic number' })
  // Held in memory rather than written to a temporary path: the buffer is
  // validated and forwarded to object storage, so nothing untrusted ever
  // touches the server's filesystem.
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string },
    @Body() dto: UploadPhotoDto,
    @ClientMeta() meta: RequestMetadata,
  ) {
    return this.photos.upload(user, id, file, dto, meta);
  }

  @Delete('photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('inspections.write')
  @ApiOperation({ summary: 'Remove a photograph before submission' })
  remove(
    @CurrentUser() user: TenantContext,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @ClientMeta() meta: RequestMetadata,
  ): Promise<void> {
    return this.photos.remove(user, photoId, meta);
  }
}
