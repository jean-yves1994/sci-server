import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('provinces')
  @ApiOperation({ summary: 'List Rwanda provinces' })
  provinces() { return this.locations.list(1); }

  @Get('districts')
  @ApiOperation({ summary: 'List districts in a province' })
  districts(@Query('provinceCode') provinceCode?: string) {
    return this.listChildren(2, provinceCode, 'provinceCode');
  }

  @Get('sectors')
  @ApiOperation({ summary: 'List sectors in a district' })
  sectors(@Query('districtCode') districtCode?: string) {
    return this.listChildren(3, districtCode, 'districtCode');
  }

  @Get('cells')
  @ApiOperation({ summary: 'List cells in a sector' })
  cells(@Query('sectorCode') sectorCode?: string) {
    return this.listChildren(4, sectorCode, 'sectorCode');
  }

  private listChildren(level: number, parentCode: string | undefined, field: string) {
    if (!parentCode?.trim()) throw new BadRequestException(`${field} is required`);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(parentCode)) throw new BadRequestException(`${field} is invalid`);
    return this.locations.list(level, parentCode);
  }
}
