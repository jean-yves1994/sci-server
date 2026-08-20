import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { TenantContext } from '../common/tenant-context';
import { PrismaService, PrismaTransactionClient } from '../database/prisma.service';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/**
 * In-application notifications, written inside the same transaction as the
 * event that caused them, so a user is never told about an approval that was
 * later rolled back.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: NotificationInput, tx?: PrismaTransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.notification.create({
        data: {
          userId: input.userId, type: input.type, title: input.title, message: input.message,
          entityType: input.entityType ?? null, entityId: input.entityId ?? null,
        },
      });
    } catch (error) {
      if (tx) throw error;
      this.logger.error(
        `Failed to create notification for ${input.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async createMany(inputs: NotificationInput[], tx?: PrismaTransactionClient): Promise<void> {
    if (inputs.length === 0) return;
    const client = tx ?? this.prisma;
    await client.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId, type: i.type, title: i.title, message: i.message,
        entityType: i.entityType ?? null, entityId: i.entityId ?? null,
      })),
    });
  }

  async list(
    user: TenantContext,
    query: { page: number; pageSize: number; unreadOnly?: boolean },
  ): Promise<PaginatedResult<unknown>> {
    const where = { userId: user.userId, ...(query.unreadOnly ? { readAt: null } : {}) };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  countUnread(user: TenantContext): Promise<number> {
    return this.prisma.notification.count({ where: { userId: user.userId, readAt: null } });
  }

  /** Scoped to the caller, so one user cannot mark another's notifications read. */
  async markRead(user: TenantContext, ids: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async markAllRead(user: TenantContext): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}
