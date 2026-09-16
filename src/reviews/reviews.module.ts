import { Module } from '@nestjs/common';
import { InspectionsModule } from '../inspections/inspections.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminInspectionEditController } from './admin-inspection-edit.controller';
import { AdminInspectionEditService } from './admin-inspection-edit.service';
import { ReviewerMapController } from './reviewer-map.controller';
import { ReviewerMapService } from './reviewer-map.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [InspectionsModule, ReportsModule],
  controllers: [ReviewsController, ReviewerMapController, AdminInspectionEditController],
  providers: [ReviewsService, ReviewerMapService, AdminInspectionEditService],
})
export class ReviewsModule {}
