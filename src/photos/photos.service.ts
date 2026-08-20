import { Injectable, Logger } from '@nestjs/common';
import { PhotoCategory } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { sha256 } from '../common/utils/crypto.util';
import { isPlausibleCoordinate } from '../common/utils/geo.util';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { isEditable } from '../inspections/domain/inspection-state-machine';
import { StorageProvider } from '../providers/storage/storage.provider';
import { UploadPhotoDto } from './dto/photo.dto';

/**
 * Magic-number signatures.
 *
 * The declared MIME type and the file extension both come from the client and
 * are trivially forged. Checking the leading bytes is what actually establishes
 * that an upload is the image it claims to be, rather than a script renamed to
 * .jpg in the hope that something downstream will execute it.
 */
const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
const SIGNED_URL_TTL_SECONDS = 600;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stores a photograph and its metadata.
   *
   * `clientRequestId` makes the upload idempotent: a phone that retries after a
   * timeout gets the original record back rather than creating a duplicate.
   */
  async upload(
    user: TenantContext,
    inspectionId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    dto: UploadPhotoDto,
    meta: RequestMetadata,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestError(ErrorCode.BAD_REQUEST, 'No file was received.');
    }

    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestError(
        ErrorCode.PHOTO_TOO_LARGE,
        `The photograph exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.`,
      );
    }

    const detected = SIGNATURES.find((signature) => signature.test(file.buffer));
    if (!detected) {
      throw new BadRequestError(
        ErrorCode.PHOTO_INVALID_TYPE,
        'Only JPEG, PNG and WebP photographs are accepted.',
      );
    }

    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true, inspectorId: true, status: true, inspectionNumber: true },
    });

    if (!inspection) {
      throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    }
    if (inspection.inspectorId !== user.userId) {
      throw new ForbiddenError(
        'Only the assigned inspector can add photographs.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }
    if (!isEditable(inspection.status)) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INVALID_TRANSITION,
        'Photographs cannot be added once an inspection has been submitted.',
      );
    }

    if (dto.clientRequestId) {
      const existing = await this.prisma.inspectionPhoto.findUnique({
        where: { clientRequestId: dto.clientRequestId },
        select: { id: true, inspectionId: true, category: true, storageKey: true },
      });
      // Returned as-is rather than treated as an error: from the device's point
      // of view the upload did succeed, and it simply never heard back.
      if (existing) return { ...existing, duplicate: true };
    }

    const checksum = sha256(file.buffer);
    const extension = detected.mime === 'image/png' ? 'png' : detected.mime === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `inspections/${inspectionId}/photos/${checksum.slice(0, 16)}.${extension}`;

    const stored = await this.storage.put(storageKey, file.buffer, detected.mime);

    const photo = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.inspectionPhoto.create({
        data: {
          inspectionId,
          assessmentId: dto.assessmentId ?? null,
          category: dto.category ?? PhotoCategory.OTHER,
          storageKey: stored.key,
          mimeType: detected.mime,
          sizeBytes: stored.sizeBytes,
          checksumSha256: stored.checksumSha256,
          caption: dto.caption?.trim() ?? null,
          // Geotag metadata is stored in the database rather than left embedded
          // in the file, so it can be queried, and so stripping the image later
          // does not lose the evidence.
          latitude:
            dto.latitude !== undefined &&
            isPlausibleCoordinate({ latitude: dto.latitude, longitude: dto.longitude ?? 0 })
              ? dto.latitude
              : null,
          longitude: dto.longitude ?? null,
          accuracyM: dto.accuracyM ?? null,
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
          capturedById: user.userId,
          clientRequestId: dto.clientRequestId ?? null,
        },
      });

      await tx.inspection.update({
        where: { id: inspectionId },
        data: { version: { increment: 1 } },
      });

      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_PHOTO_ADDED',
          entityType: 'InspectionPhoto',
          entityId: created.id,
          metadata: { inspectionId, category: created.category, sizeBytes: created.sizeBytes },
          meta,
        },
        tx,
      );

      return created;
    });

    return { ...photo, duplicate: false };
  }

  /** Lists photographs with short-lived signed URLs. */
  async list(user: TenantContext, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, branchId: true },
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

    const photos = await this.prisma.inspectionPhoto.findMany({
      where: { inspectionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { capturedBy: { select: { id: true, firstName: true, lastName: true } } },
    });

    return Promise.all(
      photos.map(async (photo) => ({
        ...photo,
        url: await this.storage.getSignedUrl(photo.storageKey, SIGNED_URL_TTL_SECONDS, 'inline'),
      })),
    );
  }

  /**
   * Removes a photograph before submission.
   *
   * Soft-deleted, and the object is left in storage: a photograph that formed
   * part of an earlier submission is evidence, and destroying the file would
   * break the traceability of any review that referenced it.
   */
  async remove(user: TenantContext, photoId: string, meta: RequestMetadata): Promise<void> {
    const photo = await this.prisma.inspectionPhoto.findFirst({
      where: { id: photoId, deletedAt: null },
      include: {
        inspection: {
          select: { id: true, organizationId: true, inspectorId: true, status: true },
        },
      },
    });

    if (!photo || photo.inspection.organizationId !== user.organizationId) {
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'Photograph not found.');
    }
    if (photo.inspection.inspectorId !== user.userId) {
      throw new ForbiddenError(
        'Only the assigned inspector can remove photographs.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }
    if (!isEditable(photo.inspection.status)) {
      throw new BadRequestError(
        ErrorCode.INSPECTION_INVALID_TRANSITION,
        'Photographs cannot be removed once an inspection has been submitted.',
      );
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspectionPhoto.update({
        where: { id: photoId },
        data: { deletedAt: new Date() },
      });
      await tx.inspection.update({
        where: { id: photo.inspectionId },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId,
          userId: user.userId,
          action: 'INSPECTION_PHOTO_REMOVED',
          entityType: 'InspectionPhoto',
          entityId: photoId,
          meta,
        },
        tx,
      );
    });
  }
}
