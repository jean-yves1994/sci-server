import { Injectable } from '@nestjs/common';
import { InspectionStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { blindIndex, encryptField } from '../common/utils/crypto.util';
import { TenantContext, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { SaveOwnerDto, SaveValuesDto } from '../inspections/dto/inspection.dto';
import { RequestMetadata } from '../common/tenant-context';

const FINAL_STATUSES: InspectionStatus[] = [InspectionStatus.APPROVED, InspectionStatus.REPORT_GENERATED, InspectionStatus.ARCHIVED];

@Injectable()
export class AdminInspectionEditService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async saveValues(user: TenantContext, id: string, dto: SaveValuesDto, meta: RequestMetadata) {
    const inspection = await this.assertAdmin(user, id, dto.baseVersion);
    await this.prisma.runInTransaction(async (tx) => {
      for (const entry of dto.values) {
        const field = await tx.templateField.findFirst({ where: { id: entry.fieldId, section: { templateId: inspection.templateId } }, select: { id: true, code: true } });
        if (!field) continue;
        const data: Prisma.InspectionValueUncheckedCreateInput = {
          inspectionId: id,
          fieldId: entry.fieldId,
          valueText: entry.valueText ?? null,
          valueNumber: entry.valueNumber ?? null,
          valueDate: entry.valueDate ? new Date(entry.valueDate) : null,
          valueBool: entry.valueBool ?? null,
          valueJson: (entry.valueJson ?? null) as Prisma.InputJsonValue,
        };
        await tx.inspectionValue.upsert({
          where: { inspectionId_fieldId: { inspectionId: id, fieldId: entry.fieldId } },
          update: {
            valueText: entry.valueText ?? null,
            valueNumber: entry.valueNumber ?? null,
            valueDate: entry.valueDate ? new Date(entry.valueDate) : null,
            valueBool: entry.valueBool ?? null,
            valueJson: (entry.valueJson ?? null) as Prisma.InputJsonValue,
          },
          create: data,
        });
      }
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record({ organizationId: user.organizationId, userId: user.userId, action: 'ADMIN_INSPECTION_FIELDS_UPDATED', entityType: 'Inspection', entityId: id, metadata: { fieldCount: dto.values.length, baseVersion: dto.baseVersion ?? null }, meta }, tx);
    });
    return { version: inspection.version + 1 };
  }

  async saveOwner(user: TenantContext, id: string, dto: SaveOwnerDto, meta: RequestMetadata) {
    const inspection = await this.assertAdmin(user, id, dto.baseVersion);
    const secret = process.env.JWT_SECRET ?? '';
    const nationalIdEnc = dto.nationalId ? encryptField(dto.nationalId.trim(), secret) : null;
    const nationalIdHash = dto.nationalId ? blindIndex(dto.nationalId, secret) : null;
    const data = { fullName: dto.fullName.trim(), nationalIdEnc, nationalIdHash, phone: dto.phone?.trim() || null, email: dto.email?.trim().toLowerCase() || null, occupancyStatus: dto.occupancyStatus ?? null, ownershipType: dto.ownershipType ?? null };
    await this.prisma.runInTransaction(async (tx) => {
      await tx.inspectionOwner.upsert({ where: { inspectionId: id }, update: data, create: { inspectionId: id, ...data } });
      await tx.inspection.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record({ organizationId: user.organizationId, userId: user.userId, action: 'ADMIN_INSPECTION_OWNER_UPDATED', entityType: 'Inspection', entityId: id, metadata: { fullName: data.fullName, baseVersion: dto.baseVersion ?? null }, meta }, tx);
    });
    return { version: inspection.version + 1 };
  }

  private async assertAdmin(user: TenantContext, id: string, baseVersion?: number) {
    const isAdmin = user.roles.some((r) => r.trim().toLowerCase() === 'admin');
    if (!isAdmin || !user.permissions.has('inspections.write')) throw new ForbiddenError('Only administrators can directly edit submitted inspection data.', ErrorCode.AUTH_FORBIDDEN);
    const inspection = await this.prisma.inspection.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null }, select: { id: true, branchId: true, templateId: true, status: true, version: true } });
    if (!inspection) throw new NotFoundError(ErrorCode.INSPECTION_NOT_FOUND, 'Inspection not found.');
    if (!canAccessBranch(user, inspection.branchId)) throw new ForbiddenError('This inspection belongs to a branch you do not have access to.', ErrorCode.AUTH_FORBIDDEN);
    if (FINAL_STATUSES.includes(inspection.status)) throw new ForbiddenError('Approved, report-ready and archived inspections cannot be edited.', ErrorCode.AUTH_FORBIDDEN);
    if (baseVersion !== undefined && baseVersion < inspection.version) throw new ConflictError(ErrorCode.INSPECTION_STALE_VERSION, 'This inspection changed while you were editing it. Reload before saving again.', { serverVersion: inspection.version });
    return inspection;
  }
}
