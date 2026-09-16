import { Injectable } from '@nestjs/common';
import { InspectionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { sha256 } from '../common/utils/crypto.util';
import { RequestMetadata, TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { StorageProvider } from '../providers/storage/storage.provider';

const MAX_MAP_BYTES = 15 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 900;
const REVIEWABLE: InspectionStatus[] = [InspectionStatus.SUBMITTED, InspectionStatus.UNDER_REVIEW, InspectionStatus.RESUBMITTED];

const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

@Injectable()
export class ReviewerMapService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageProvider, private readonly audit: AuditService) {}

  async get(user: TenantContext, inspectionId: string) {
    const inspection = await this.inspection(user, inspectionId);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, inspection_id AS "inspectionId", reviewer_id AS "reviewerId", storage_key AS "storageKey",
             mime_type AS "mimeType", size_bytes AS "sizeBytes", checksum_sha256 AS "checksumSha256",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM reviewer_map_images WHERE inspection_id = ${inspection.id} LIMIT 1`;
    const map = rows[0];
    if (!map) return null;
    return { ...map, url: await this.storage.getSignedUrl(String(map.storageKey), SIGNED_URL_TTL_SECONDS, 'inline') };
  }

  async upload(user: TenantContext, inspectionId: string, file: { buffer: Buffer; mimetype: string; originalname: string }, meta: RequestMetadata) {
    const inspection = await this.assertEditable(user, inspectionId);
    if (!file?.buffer?.length) throw new BadRequestError(ErrorCode.BAD_REQUEST, 'No map image was received.');
    if (file.buffer.byteLength > MAX_MAP_BYTES) throw new BadRequestError(ErrorCode.PHOTO_TOO_LARGE, 'The map image exceeds the 15MB limit.');
    const detected = SIGNATURES.find((x) => x.test(file.buffer));
    if (!detected) throw new BadRequestError(ErrorCode.PHOTO_INVALID_TYPE, 'Only JPEG, PNG and WebP map images are accepted.');

    const checksum = sha256(file.buffer);
    const extension = detected.mime === 'image/png' ? 'png' : detected.mime === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `inspections/${inspectionId}/review/map/${checksum.slice(0, 32)}.${extension}`;
    const stored = await this.storage.put(storageKey, file.buffer, detected.mime);
    const previous = await this.prisma.$queryRaw<Array<{ storageKey: string }>>`SELECT storage_key AS "storageKey" FROM reviewer_map_images WHERE inspection_id = ${inspectionId} LIMIT 1`;

    const map = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.$queryRaw<Array<Record<string, unknown>>>`
        INSERT INTO reviewer_map_images (inspection_id, reviewer_id, storage_key, mime_type, size_bytes, checksum_sha256, created_at, updated_at)
        VALUES (${inspectionId}, ${user.userId}, ${stored.key}, ${detected.mime}, ${stored.sizeBytes}, ${stored.checksumSha256}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (inspection_id) DO UPDATE SET reviewer_id = EXCLUDED.reviewer_id,
          storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
          checksum_sha256 = EXCLUDED.checksum_sha256, updated_at = CURRENT_TIMESTAMP
        RETURNING id, inspection_id AS "inspectionId", reviewer_id AS "reviewerId", storage_key AS "storageKey",
          mime_type AS "mimeType", size_bytes AS "sizeBytes", checksum_sha256 AS "checksumSha256", created_at AS "createdAt", updated_at AS "updatedAt"`;
      await tx.inspection.update({ where: { id: inspectionId }, data: { version: { increment: 1 } } });
      await this.audit.record({ organizationId: user.organizationId, userId: user.userId, action: previous[0] ? 'REVIEWER_MAP_REPLACED' : 'REVIEWER_MAP_UPLOADED', entityType: 'ReviewerMapImage', entityId: String(result[0].id), metadata: { inspectionId, storageKey: stored.key, sizeBytes: stored.sizeBytes }, meta }, tx);
      return result[0];
    });

    if (previous[0] && previous[0].storageKey !== stored.key) await this.storage.delete(previous[0].storageKey);
    return { ...map, url: await this.storage.getSignedUrl(stored.key, SIGNED_URL_TTL_SECONDS, 'inline') };
  }

  async remove(user: TenantContext, inspectionId: string, meta: RequestMetadata) {
    await this.assertEditable(user, inspectionId);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; storageKey: string }>>`SELECT id, storage_key AS "storageKey" FROM reviewer_map_images WHERE inspection_id = ${inspectionId} LIMIT 1`;
    if (!rows[0]) throw new NotFoundError(ErrorCode.NOT_FOUND, 'No reviewer map image is attached.');
    await this.prisma.runInTransaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM reviewer_map_images WHERE inspection_id = ${inspectionId}`;
      await tx.inspection.update({ where: { id: inspectionId }, data: { version: { increment: 1 } } });
      await this.audit.record({ organizationId: user.organizationId, userId: user.userId, action: 'REVIEWER_MAP_REMOVED', entityType: 'ReviewerMapImage', entityId: rows[0].id, metadata: { inspectionId }, meta }, tx);
    });
    await this.storage.delete(rows[0].storageKey);
  }

  private async inspection(user: TenantContext, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id: inspectionId, organizationId: user.organizationId, deletedAt: null }, select: { id: true, branchId: true, reviewerId: true, status: true, version: true } });
    if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    if (!canAccessBranch(user, inspection.branchId)) throw new ForbiddenError('This inspection belongs to a branch you do not have access to.', ErrorCode.AUTH_FORBIDDEN);
    return inspection;
  }

  private async assertEditable(user: TenantContext, inspectionId: string) {
    const inspection = await this.inspection(user, inspectionId);
    if (!REVIEWABLE.includes(inspection.status)) throw new BadRequestError(ErrorCode.INSPECTION_INVALID_TRANSITION, 'The reviewer map can only be changed while the inspection is awaiting review.');
    if (!inspection.reviewerId || inspection.reviewerId !== user.userId) throw new ForbiddenError('Only the reviewer who claimed this inspection can modify the reviewer map.', ErrorCode.AUTH_FORBIDDEN);
    return inspection;
  }
}
