import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { ConflictError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { OPEN_STATUSES } from '../inspections/domain/inspection-state-machine';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: TenantContext, query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.BranchWhereInput = {
      organizationId: user.organizationId, deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.branch.findMany({
        where, orderBy: { code: 'asc' },
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: {
          division: { select: { id: true, name: true } },
          _count: { select: { users: true, inspections: true, properties: true } },
        },
      }),
      this.prisma.branch.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  async findOne(user: TenantContext, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: {
        division: true,
        _count: { select: { users: true, inspections: true, properties: true } },
      },
    });
    if (!branch) throw new NotFoundError(ErrorCode.NOT_FOUND, 'Branch not found.');
    return branch;
  }

  async create(user: TenantContext, dto: CreateBranchDto, meta: RequestMetadata) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.branch.findFirst({
      where: { organizationId: user.organizationId, code },
    });
    if (existing) {
      throw new ConflictError(
        ErrorCode.BRANCH_CODE_EXISTS, `A branch with the code ${code} already exists.`,
      );
    }

    const branch = await this.prisma.branch.create({
      data: {
        organizationId: user.organizationId, code,
        name: dto.name.trim(),
        addressLine: dto.addressLine?.trim() ?? null,
        divisionId: dto.divisionId ?? null,
        phone: dto.phone?.trim() ?? null,
        email: dto.email?.trim().toLowerCase() ?? null,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'BRANCH_CREATED', entityType: 'Branch', entityId: branch.id,
      newValue: { code, name: branch.name }, meta,
    });

    return branch;
  }

  async update(user: TenantContext, id: string, dto: UpdateBranchDto, meta: RequestMetadata) {
    const before = await this.findOne(user, id);

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine.trim() } : {}),
        ...(dto.divisionId !== undefined ? { divisionId: dto.divisionId } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'BRANCH_UPDATED', entityType: 'Branch', entityId: id,
      previousValue: { name: before.name, status: before.status },
      newValue: { ...dto }, meta,
    });

    return branch;
  }

  /**
   * Soft delete. Branches are referenced by historical inspections; a hard
   * delete would either fail on the foreign key or destroy the record of who
   * inspected what.
   */
  async remove(user: TenantContext, id: string, meta: RequestMetadata): Promise<void> {
    await this.findOne(user, id);

    const open = await this.prisma.inspection.count({
      where: { branchId: id, deletedAt: null, status: { in: OPEN_STATUSES } },
    });

    if (open > 0) {
      throw new ConflictError(
        ErrorCode.CONFLICT,
        `This branch still has ${open} inspection(s) in progress.`,
      );
    }

    await this.prisma.branch.update({
      where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' },
    });

    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'BRANCH_DEACTIVATED', entityType: 'Branch', entityId: id, meta,
    });
  }
}
