import { Module } from '@nestjs/common';
import { InspectionsModule } from '../inspections/inspections.module';
import { ReportsModule } from '../reports/reports.module';
import { ReviewerMapController } from './reviewer-map.controller';
import { ReviewerMapService } from './reviewer-map.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [InspectionsModule, ReportsModule],
  controllers: [ReviewsController, ReviewerMapController],
  providers: [ReviewsService, ReviewerMapService],
})
export class ReviewsModule {}
