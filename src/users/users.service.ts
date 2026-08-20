import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { checkPasswordPolicy, hashPassword } from '../common/utils/password.util';
import { RequestMetadata, TenantContext } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto, ResetUserPasswordDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';

/** Never includes passwordHash. */
const USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, phone: true,
  employeeNumber: true, status: true, branchId: true, branchScope: true,
  lastLoginAt: true, mustChangePassword: true, lockedUntil: true, createdAt: true,
  branch: { select: { id: true, code: true, name: true } },
  userRoles: { select: { role: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: TenantContext, query: UserQueryDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.UserWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      // A branch-scoped administrator sees only colleagues in their branch.
      ...(user.branchScope === 'OWN_BRANCH' ? { branchId: { in: user.accessibleBranchIds } } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleCode
        ? { userRoles: { some: { role: { code: query.roleCode } } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { employeeNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where, select: USER_SELECT,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  async findOne(user: TenantContext, id: string) {
    const record = await this.prisma.user.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!record) throw new NotFoundError(ErrorCode.NOT_FOUND, 'User not found.');
    return record;
  }

  async create(user: TenantContext, dto: CreateUserDto, meta: RequestMetadata) {
    const email = dto.email.trim().toLowerCase();

    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictError(
        ErrorCode.USER_EMAIL_EXISTS,
        'An account with that email address already exists.',
      );
    }

    const policy = checkPasswordPolicy(dto.password);
    if (!policy.valid) {
      throw new BadRequestError(
        ErrorCode.AUTH_PASSWORD_POLICY,
        `The password must ${policy.failures.join(', ')}.`,
      );
    }

    const roles = await this.resolveRoles(user.organizationId, dto.roleCodes);
    const passwordHash = await hashPassword(dto.password);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const record = await tx.user.create({
        data: {
          organizationId: user.organizationId,
          branchId: dto.branchId ?? null,
          email, passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone?.trim() ?? null,
          employeeNumber: dto.employeeNumber?.trim() ?? null,
          branchScope: dto.branchScope ?? 'OWN_BRANCH',
          status: 'PENDING_ACTIVATION',
          // The administrator chose this password, so the owner must replace it
          // with one only they know before doing anything else.
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        },
      });

      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: record.id, roleId: role.id, assignedBy: user.userId })),
      });

      await this.audit.record(
        {
          organizationId: user.organizationId, userId: user.userId,
          action: 'USER_CREATED', entityType: 'User', entityId: record.id,
          newValue: { email, roles: dto.roleCodes, branchScope: record.branchScope },
          meta,
        },
        tx,
      );

      return record;
    });

    return this.findOne(user, created.id);
  }

  async update(user: TenantContext, id: string, dto: UpdateUserDto, meta: RequestMetadata) {
    const before = await this.findOne(user, id);

    // Guards against an administrator locking themselves out, which in a small
    // institution can mean nobody can administer the system at all.
    if (id === user.userId && dto.status && dto.status !== 'ACTIVE') {
      throw new BadRequestError(ErrorCode.BAD_REQUEST, 'You cannot deactivate your own account.');
    }

    const roles = dto.roleCodes ? await this.resolveRoles(user.organizationId, dto.roleCodes) : null;

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
          ...(dto.employeeNumber !== undefined ? { employeeNumber: dto.employeeNumber.trim() } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.branchScope !== undefined ? { branchScope: dto.branchScope } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });

      if (roles) {
        // Replaces the whole set: any role not listed is revoked.
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: id, roleId: role.id, assignedBy: user.userId })),
        });
      }

      // Deactivation takes effect immediately rather than at token expiry.
      if (dto.status === 'SUSPENDED' || dto.status === 'DISABLED') {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
        });
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DEACTIVATED' },
        });
      }

      await this.audit.record(
        {
          organizationId: user.organizationId, userId: user.userId,
          action: 'USER_UPDATED', entityType: 'User', entityId: id,
          previousValue: {
            status: before.status, branchScope: before.branchScope,
            roles: before.userRoles.map((r) => r.role.code),
          },
          newValue: { ...dto },
          meta,
        },
        tx,
      );
    });

    return this.findOne(user, id);
  }

  async resetPassword(
    user: TenantContext, id: string, dto: ResetUserPasswordDto, meta: RequestMetadata,
  ): Promise<void> {
    await this.findOne(user, id);

    const policy = checkPasswordPolicy(dto.newPassword);
    if (!policy.valid) {
      throw new BadRequestError(
        ErrorCode.AUTH_PASSWORD_POLICY,
        `The password must ${policy.failures.join(', ')}.`,
      );
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          // Forced, so the administrator who set it does not retain knowledge
          // of a working credential for somebody else's account.
          mustChangePassword: true,
          passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN_PASSWORD_RESET' },
      });
      await this.audit.record(
        {
          organizationId: user.organizationId, userId: user.userId,
          action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id, meta,
        },
        tx,
      );
    });
  }

  async unlock(user: TenantContext, id: string, meta: RequestMetadata): Promise<void> {
    await this.findOne(user, id);
    await this.prisma.user.update({
      where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'USER_UNLOCKED', entityType: 'User', entityId: id, meta,
    });
  }

  /** Inspectors available for assignment, for the assignment dropdown. */
  listInspectors(user: TenantContext, branchId?: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId: user.organizationId, deletedAt: null,
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
        ...(branchId ? { OR: [{ branchId }, { branchScope: 'ALL_BRANCHES' }] } : {}),
        userRoles: {
          some: { role: { rolePermissions: { some: { permission: { code: 'inspections.write' } } } } },
        },
      },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        branch: { select: { id: true, code: true } },
        _count: {
          select: {
            inspectionsAssigned: {
              where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'CORRECTION_REQUESTED'] } },
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }],
    });
  }

  private async resolveRoles(organizationId: string, codes: string[]) {
    const unique = [...new Set(codes.map((c) => c.trim().toUpperCase()))];
    const roles = await this.prisma.role.findMany({
      where: { organizationId, code: { in: unique } }, select: { id: true, code: true },
    });

    if (roles.length !== unique.length) {
      const found = new Set(roles.map((r) => r.code));
      throw new BadRequestError(
        ErrorCode.BAD_REQUEST,
        `Unknown role(s): ${unique.filter((c) => !found.has(c)).join(', ')}.`,
      );
    }
    return roles;
  }
}
