import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate, PaginationQueryDto } from '../common/dto/pagination.dto';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestMetadata, TenantContext, buildTenantScope, canAccessBranch } from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/property.dto';

const PROPERTY_TYPES = ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Land', 'Other'] as const;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: TenantContext, query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const scope = buildTenantScope(user);

    const where: Prisma.PropertyWhereInput = {
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { ownerClientName: { contains: query.search, mode: 'insensitive' } },
              { propertyType: { contains: query.search, mode: 'insensitive' } },
              { province: { contains: query.search, mode: 'insensitive' } },
              { district: { contains: query.search, mode: 'insensitive' } },
              { sector: { contains: query.search, mode: 'insensitive' } },
              { cell: { contains: query.search, mode: 'insensitive' } },
              { villageStreet: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          branch: { select: { id: true, code: true, name: true } },
          division: { select: { id: true, name: true } },
          _count: { select: { inspections: true } },
        },
      }),
      this.prisma.property.count({ where }),
    ]);

    return paginate(rows, total, query.page, query.pageSize);
  }

  async findOne(user: TenantContext, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        division: true,
        inspections: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            inspectionNumber: true,
            status: true,
            createdAt: true,
            loanReference: true,
          },
        },
      },
    });

    if (!property) throw new NotFoundError(ErrorCode.NOT_FOUND, 'Property not found.');
    if (!canAccessBranch(user, property.branchId)) {
      throw new ForbiddenError(
        'This property belongs to a branch you do not have access to.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }
    return property;
  }

  private async generateReference(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reference = `PROP-${year}-${String(randomInt(0, 10000)).padStart(4, '0')}`;
      const existing = await this.prisma.property.findFirst({
        where: { organizationId, reference },
        select: { id: true },
      });
      if (!existing) return reference;
    }

    throw new ConflictError(
      ErrorCode.CONFLICT,
      'Unable to generate a unique property reference. Please try again.',
    );
  }

  async create(user: TenantContext, dto: CreatePropertyDto, meta: RequestMetadata) {
    const branchId = dto.branchId ?? user.branchId;
    if (!branchId || !canAccessBranch(user, branchId)) {
      throw new ForbiddenError(
        'You cannot register a property for that branch.',
        ErrorCode.AUTH_FORBIDDEN,
      );
    }

    const propertyType = dto.propertyType.trim();
    if (!PROPERTY_TYPES.includes(propertyType as (typeof PROPERTY_TYPES)[number])) {
      throw new ConflictError(
        ErrorCode.BAD_REQUEST,
        `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`,
      );
    }

    const reference = dto.reference?.trim().toUpperCase() || await this.generateReference(user.organizationId);

    const existing = await this.prisma.property.findFirst({
      where: { organizationId: user.organizationId, reference },
    });
    if (existing) {
      throw new ConflictError(
        ErrorCode.CONFLICT,
        `A property with the reference ${reference} already exists.`,
      );
    }

    const property = await this.prisma.property.create({
      data: {
        organizationId: user.organizationId,
        branchId,
        reference,
        name: dto.name.trim(),
        propertyType,
        ownerClientName: dto.ownerClientName.trim(),
        province: dto.province.trim(),
        district: dto.district.trim(),
        sector: dto.sector.trim(),
        cell: dto.cell.trim(),
        villageStreet: dto.villageStreet?.trim() || null,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.userId,
      action: 'PROPERTY_CREATED',
      entityType: 'Property',
      entityId: property.id,
      newValue: {
        reference,
        name: property.name,
        propertyType: property.propertyType,
        ownerClientName: property.ownerClientName,
        province: property.province,
        district: property.district,
        sector: property.sector,
        cell: property.cell,
        villageStreet: property.villageStreet,
      },
      meta,
    });

    return property;
  }

  async update(user: TenantContext, id: string, dto: UpdatePropertyDto, meta: RequestMetadata) {
    const before = await this.findOne(user, id);

    if (dto.propertyType !== undefined) {
      const propertyType = dto.propertyType.trim();
      if (!PROPERTY_TYPES.includes(propertyType as (typeof PROPERTY_TYPES)[number])) {
        throw new ConflictError(
          ErrorCode.BAD_REQUEST,
          `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`,
        );
      }
    }

    const property = await this.prisma.property.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.propertyType !== undefined ? { propertyType: dto.propertyType.trim() } : {}),
        ...(dto.ownerClientName !== undefined ? { ownerClientName: dto.ownerClientName.trim() } : {}),
        ...(dto.province !== undefined ? { province: dto.province.trim() } : {}),
        ...(dto.district !== undefined ? { district: dto.district.trim() } : {}),
        ...(dto.sector !== undefined ? { sector: dto.sector.trim() } : {}),
        ...(dto.cell !== undefined ? { cell: dto.cell.trim() } : {}),
        ...(dto.villageStreet !== undefined ? { villageStreet: dto.villageStreet.trim() || null } : {}),
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.userId,
      action: 'PROPERTY_UPDATED',
      entityType: 'Property',
      entityId: id,
      previousValue: {
        name: before.name,
        propertyType: before.propertyType,
        ownerClientName: before.ownerClientName,
        province: before.province,
        district: before.district,
        sector: before.sector,
        cell: before.cell,
        villageStreet: before.villageStreet,
      },
      newValue: { ...dto },
      meta,
    });

    return property;
  }
}
