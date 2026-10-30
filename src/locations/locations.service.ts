import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(level: number, parentCode?: string) {
    const items = await this.prisma.rwandaLocation.findMany({
      where: { level, ...(parentCode ? { parentCode } : {}) },
      select: { code: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { items };
  }
}
