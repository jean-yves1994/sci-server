-- Add reviewer-entered parcel status information without changing historical inspection data.
ALTER TABLE "inspections"
  ADD COLUMN IF NOT EXISTS "mortgageStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "restrictionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "processStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "remainingLeaseTermMonths" INTEGER;

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_mortgage_status_check"
    CHECK ("mortgageStatus" IS NULL OR "mortgageStatus" IN ('UNDER_MORTGAGE', 'NOT_UNDER_MORTGAGE')),
  ADD CONSTRAINT "inspections_restriction_status_check"
    CHECK ("restrictionStatus" IS NULL OR "restrictionStatus" IN ('UNDER_RESTRICTION', 'NOT_UNDER_RESTRICTION')),
  ADD CONSTRAINT "inspections_process_status_check"
    CHECK ("processStatus" IS NULL OR "processStatus" IN ('UNDER_PROCESS', 'NOT_UNDER_PROCESS')),
  ADD CONSTRAINT "inspections_remaining_lease_term_months_check"
    CHECK ("remainingLeaseTermMonths" IS NULL OR "remainingLeaseTermMonths" >= 0);
