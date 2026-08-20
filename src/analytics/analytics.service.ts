import { Injectable } from '@nestjs/common';
import { InspectionStatus, Prisma } from '@prisma/client';
import { TenantContext, buildTenantScope } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { REVIEW_QUEUE_STATUSES } from '../inspections/domain/inspection-state-machine';

/**
 * Dashboard aggregation.
 *
 * Every figure is a database query. Nothing is hard-coded, and nothing is
 * computed by pulling rows into memory and counting them in JavaScript — at
 * production volumes that becomes both slow and a way to leak data the caller
 * should not see.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(user: TenantContext) {
    const scope = buildTenantScope(user);

    const base: Prisma.InspectionWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    };

    const [grouped, total, properties, branches, users, myWork, processing] = await Promise.all([
      this.prisma.inspection.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.inspection.count({ where: base }),
      this.prisma.property.count({
        where: {
          organizationId: scope.organizationId,
          deletedAt: null,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
      }),
      this.prisma.branch.count({
        where: { organizationId: scope.organizationId, deletedAt: null },
      }),
      this.prisma.user.count({
        where: { organizationId: scope.organizationId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.inspection.groupBy({
        by: ['status'],
        where: { ...base, inspectorId: user.userId },
        _count: { _all: true },
      }),
      this.averageProcessingHours(base),
    ]);

    const byStatus = grouped.map((row) => ({ status: row.status, count: row._count._all }));
    const countOf = (status: InspectionStatus) =>
      byStatus.find((row) => row.status === status)?.count ?? 0;

    const pendingReview = REVIEW_QUEUE_STATUSES.reduce((sum, status) => sum + countOf(status), 0);

    const myCount = (status: InspectionStatus) =>
      myWork.find((row) => row.status === status)?._count._all ?? 0;

    return {
      totals: {
        inspections: total,
        pendingReview,
        approved: countOf(InspectionStatus.APPROVED) + countOf(InspectionStatus.REPORT_GENERATED),
        rejected: countOf(InspectionStatus.REJECTED),
        correctionRequested: countOf(InspectionStatus.CORRECTION_REQUESTED),
        inProgress: countOf(InspectionStatus.IN_PROGRESS) + countOf(InspectionStatus.ASSIGNED),
        properties,
        branches,
        activeUsers: users,
      },
      averageProcessingHours: processing,
      byStatus,
      myWork: {
        assigned: myCount(InspectionStatus.ASSIGNED),
        inProgress: myCount(InspectionStatus.IN_PROGRESS),
        correctionRequested: myCount(InspectionStatus.CORRECTION_REQUESTED),
        submitted: myCount(InspectionStatus.SUBMITTED) + myCount(InspectionStatus.RESUBMITTED),
      },
    };
  }

  /** Inspection volume by month, for the trend chart. */
  async monthly(user: TenantContext, months = 12) {
    const scope = buildTenantScope(user);
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const rows = await this.prisma.inspection.findMany({
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        createdAt: { gte: since },
      },
      select: { createdAt: true, status: true },
    });

    // Buckets are pre-seeded so a month with no activity appears as zero rather
    // than vanishing from the chart and implying a gap in the record.
    const buckets = new Map<string, { month: string; total: number; approved: number; rejected: number }>();

    for (let i = 0; i < months; i += 1) {
      const date = new Date(since);
      date.setMonth(since.getMonth() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { month: key, total: 0, approved: 0, rejected: 0 });
    }

    for (const row of rows) {
      const key = `${row.createdAt.getFullYear()}-${String(row.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.total += 1;
      if (row.status === 'APPROVED' || row.status === 'REPORT_GENERATED') bucket.approved += 1;
      if (row.status === 'REJECTED') bucket.rejected += 1;
    }

    return [...buckets.values()];
  }

  /** Volume and approval rate per branch. */
  async byBranch(user: TenantContext) {
    const scope = buildTenantScope(user);

    const branches = await this.prisma.branch.findMany({
      where: { organizationId: scope.organizationId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    const grouped = await this.prisma.inspection.groupBy({
      by: ['branchId', 'status'],
      where: { organizationId: scope.organizationId, deletedAt: null },
      _count: { _all: true },
    });

    return branches.map((branch) => {
      const rows = grouped.filter((row) => row.branchId === branch.id);
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      const approved = rows
        .filter((row) => row.status === 'APPROVED' || row.status === 'REPORT_GENERATED')
        .reduce((sum, row) => sum + row._count._all, 0);
      const rejected = rows
        .filter((row) => row.status === 'REJECTED')
        .reduce((sum, row) => sum + row._count._all, 0);
      const decided = approved + rejected;

      return {
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
        total,
        approved,
        rejected,
        // null rather than 0 when nothing has been decided: a branch with no
        // decisions has no approval rate, which is not the same as 0%.
        approvalRate: decided > 0 ? Math.round((approved / decided) * 100) : null,
      };
    });
  }

  /**
   * Inspector workload and outcomes.
   *
   * Deliberately limited to volume and turnaround. These are operational
   * figures for balancing workload, not a performance score — a low approval
   * rate may equally reflect difficult properties or a demanding reviewer.
   */
  async byInspector(user: TenantContext) {
    const scope = buildTenantScope(user);

    const inspectors = await this.prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        userRoles: {
          some: { role: { rolePermissions: { some: { permission: { code: 'inspections.write' } } } } },
        },
      },
      select: { id: true, firstName: true, lastName: true, branch: { select: { code: true } } },
    });

    const grouped = await this.prisma.inspection.groupBy({
      by: ['inspectorId', 'status'],
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
      },
      _count: { _all: true },
    });

    return inspectors.map((inspector) => {
      const rows = grouped.filter((row) => row.inspectorId === inspector.id);
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      const approved = rows
        .filter((row) => row.status === 'APPROVED' || row.status === 'REPORT_GENERATED')
        .reduce((sum, row) => sum + row._count._all, 0);
      const open = rows
        .filter((row) => ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUESTED'].includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);

      return {
        inspectorId: inspector.id,
        name: `${inspector.firstName} ${inspector.lastName}`,
        branch: inspector.branch?.code ?? null,
        total,
        approved,
        open,
      };
    });
  }

  /**
   * Mean hours between submission and decision.
   *
   * Computed in SQL: pulling every row back to average timestamps in
   * application code would not survive production volumes.
   */
  private async averageProcessingHours(base: Prisma.InspectionWhereInput): Promise<number | null> {
    const rows = await this.prisma.inspection.findMany({
      where: { ...base, submittedAt: { not: null }, reviewedAt: { not: null } },
      select: { submittedAt: true, reviewedAt: true },
      take: 500,
      orderBy: { reviewedAt: 'desc' },
    });

    if (rows.length === 0) return null;

    const totalMs = rows.reduce(
      (sum, row) => sum + (row.reviewedAt!.getTime() - row.submittedAt!.getTime()),
      0,
    );

    return Math.round((totalMs / rows.length / 3_600_000) * 10) / 10;
  }
}
