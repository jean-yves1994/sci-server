import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaginatedResult, paginate } from '../common/dto/pagination.dto';
import { ConflictError, ForbiddenError, NotFoundError } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { isPlausibleCoordinate } from '../common/utils/geo.util';
import {
  RequestMetadata, TenantContext, buildTenantScope, canAccessBranch,
} from '../common/tenant-context';
import { PrismaService } from '../database/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/property.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: TenantContext, query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const scope = buildTenantScope(user);

    const where: Prisma.PropertyWhereInput = {
      organizationId: scope.organizationId, deletedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { addressLine: { contains: query.search, mode: 'insensitive' } },
              { plotNumber: { contains: query.search, mode: 'insensitive' } },
              { titleNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
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
          orderBy: { createdAt: 'desc' }, take: 20,
          select: {
            id: true, inspectionNumber: true, status: true, createdAt: true,
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

  async create(user: TenantContext, dto: CreatePropertyDto, meta: RequestMetadata) {
    if (!canAccessBranch(user, dto.branchId)) {
      throw new ForbiddenError(
        'You cannot register a property for that branch.', ErrorCode.AUTH_FORBIDDEN,
      );
    }

    const reference = dto.reference.trim().toUpperCase();

    const existing = await this.prisma.property.findFirst({
      where: { organizationId: user.organizationId, reference },
    });
    if (existing) {
      throw new ConflictError(
        ErrorCode.CONFLICT, `A property with the reference ${reference} already exists.`,
      );
    }

    // Registered coordinates are the reference point for every later
    // proof-of-presence check, so an implausible pair is rejected at entry
    // rather than quietly poisoning the distance calculations.
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      if (!isPlausibleCoordinate({ latitude: dto.latitude, longitude: dto.longitude })) {
        throw new ConflictError(
          ErrorCode.BAD_REQUEST, 'The coordinates supplied are not a valid location.',
        );
      }
    }

    const property = await this.prisma.property.create({
      data: {
        organizationId: user.organizationId, branchId: dto.branchId, reference,
        propertyType: dto.propertyType.trim(),
        addressLine: dto.addressLine.trim(),
        divisionId: dto.divisionId ?? null,
        plotNumber: dto.plotNumber?.trim() ?? null,
        titleNumber: dto.titleNumber?.trim() ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'PROPERTY_CREATED', entityType: 'Property', entityId: property.id,
      newValue: { reference, propertyType: property.propertyType }, meta,
    });

    return property;
  }

  async update(user: TenantContext, id: string, dto: UpdatePropertyDto, meta: RequestMetadata) {
    const before = await this.findOne(user, id);

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      if (!isPlausibleCoordinate({ latitude: dto.latitude, longitude: dto.longitude })) {
        throw new ConflictError(
          ErrorCode.BAD_REQUEST, 'The coordinates supplied are not a valid location.',
        );
      }
    }

    const property = await this.prisma.property.update({
      where: { id },
      data: {
        ...(dto.propertyType !== undefined ? { propertyType: dto.propertyType.trim() } : {}),
        ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine.trim() } : {}),
        ...(dto.divisionId !== undefined ? { divisionId: dto.divisionId } : {}),
        ...(dto.plotNumber !== undefined ? { plotNumber: dto.plotNumber.trim() } : {}),
        ...(dto.titleNumber !== undefined ? { titleNumber: dto.titleNumber.trim() } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      },
    });

    await this.audit.record({
      organizationId: user.organizationId, userId: user.userId,
      action: 'PROPERTY_UPDATED', entityType: 'Property', entityId: id,
      previousValue: {
        addressLine: before.addressLine,
        latitude: before.latitude, longitude: before.longitude,
      },
      newValue: { ...dto }, meta,
    });

    return property;
  }
}
