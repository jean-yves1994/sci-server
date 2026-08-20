import { Injectable, Logger } from '@nestjs/common';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  meta?: RequestMetadata;
}

/**
 * Append-only audit trail.
 *
 * There is deliberately no update or delete method. An audit log the
 * application can edit is not evidence of anything.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass `tx` when the audited change is itself transactional, so record and
   * change commit or roll back together. Outside a transaction a failure is
   * logged loudly rather than thrown: losing the audit line is bad, but failing
   * the user's operation because of it is worse.
   */
  async record(entry: AuditEntry, tx?: PrismaTransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          previousValue: entry.previousValue ? this.toJson(entry.previousValue) : undefined,
          newValue: entry.newValue ? this.toJson(entry.newValue) : undefined,
          metadata: entry.metadata ? this.toJson(entry.metadata) : undefined,
          ipAddress: entry.meta?.ipAddress ?? null,
          userAgent: entry.meta?.userAgent ?? null,
        },
      });
    } catch (error) {
      if (tx) throw error;
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.entityType}:${entry.entityId ?? '-'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(
    user: TenantContext,
    query: {
      page: number; pageSize: number; action?: string; entityType?: string;
      userId?: string; from?: Date; to?: Date;
    },
  ): Promise<PaginatedResult<unknown>> {
    const where = {
      organizationId: user.organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  private toJson(value: unknown) {
    // Round-trips through JSON so Date and Decimal become storable primitives.
    return JSON.parse(JSON.stringify(value));
  }
}
