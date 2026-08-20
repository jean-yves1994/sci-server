import { Module } from '@nestjs/common';
import { ReportRenderer } from './report-renderer';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportRenderer],
  exports: [ReportsService],
})
export class ReportsModule {}
