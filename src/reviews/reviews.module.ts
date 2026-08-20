import { Module } from '@nestjs/common';
import { InspectionsModule } from '../inspections/inspections.module';
import { ReportsModule } from '../reports/reports.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [InspectionsModule, ReportsModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
