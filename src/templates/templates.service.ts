import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';

/**
 * Inspection templates.
 *
 * Templates are versioned rather than edited in place. An inspection already
 * carried out under version 1 must keep rendering against version 1, otherwise
 * a historical report would silently change shape when somebody edits a form.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: TenantContext) {
    return this.prisma.inspectionTemplate.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: { fields: { orderBy: { sortOrder: 'asc' } } },
        },
        photoRules: true,
        _count: { select: { inspections: true } },
      },
    });
  }

  async findOne(user: TenantContext, id: string) {
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: { fields: { orderBy: { sortOrder: 'asc' } } },
        },
        photoRules: true,
      },
    });
    if (!template) throw new NotFoundError(ErrorCode.NOT_FOUND, 'Template not found.');
    return template;
  }

  /** The template the mobile app should use for new work. */
  async getDefault(user: TenantContext) {
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: { organizationId: user.organizationId, isDefault: true, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: { fields: { orderBy: { sortOrder: 'asc' } } },
        },
        photoRules: true,
      },
    });
    if (!template) {
      throw new NotFoundError(
        ErrorCode.NOT_FOUND,
        'No active default template is configured. Ask an administrator to set one up.',
      );
    }
    return template;
  }
}
