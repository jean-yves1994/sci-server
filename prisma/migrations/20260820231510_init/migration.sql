-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "BranchScope" AS ENUM ('OWN_BRANCH', 'ALL_BRANCHES');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUESTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'REPORT_GENERATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConditionStatus" AS ENUM ('CRITICAL', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT');

-- CreateEnum
CREATE TYPE "OccupancyStatus" AS ENUM ('OWNER_OCCUPIED', 'TENANT_OCCUPIED', 'VACANT', 'PARTIALLY_OCCUPIED', 'UNDER_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('FREEHOLD', 'LEASEHOLD', 'CUSTOMARY', 'CO_OWNERSHIP', 'COMPANY_OWNED');

-- CreateEnum
CREATE TYPE "PhotoCategory" AS ENUM ('FRONT_VIEW', 'REAR_VIEW', 'LEFT_SIDE', 'RIGHT_SIDE', 'INTERIOR', 'ROOF', 'FOUNDATION', 'ROAD_ACCESS', 'UTILITIES', 'SURROUNDINGS', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GPS', 'NETWORK', 'FUSED', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommentType" AS ENUM ('REVIEWER_NOTE', 'CORRECTION_REQUEST', 'REJECTION_REASON', 'APPROVAL_NOTE', 'INSPECTOR_RESPONSE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNMENT_CREATED', 'ASSIGNMENT_CHANGED', 'INSPECTION_SUBMITTED', 'INSPECTION_APPROVED', 'INSPECTION_REJECTED', 'CORRECTION_REQUESTED', 'REPORT_READY', 'SYSTEM_ALERT');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'PHONE', 'EMAIL', 'NATIONAL_ID');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "addressLine" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoStorageKey" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_divisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT,
    "divisionId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "employeeNumber" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "branchScope" "BranchScope" NOT NULL DEFAULT 'OWN_BRANCH',
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "deviceId" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_sections" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAssessment" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_fields" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "validation" JSONB,
    "helpText" TEXT,

    CONSTRAINT "template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_photo_rules" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "category" "PhotoCategory" NOT NULL,
    "minCount" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,

    CONSTRAINT "template_photo_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "divisionId" TEXT,
    "plotNumber" TEXT,
    "titleNumber" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "inspectionNumber" TEXT NOT NULL,
    "loanReference" TEXT NOT NULL,
    "clientName" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "inspectorId" TEXT,
    "reviewerId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "assignmentNotes" TEXT,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_owners" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT,
    "nationalIdHash" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "occupancyStatus" "OccupancyStatus",
    "ownershipType" "OwnershipType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_values" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,2),
    "valueDate" TIMESTAMP(3),
    "valueBool" BOOLEAN,
    "valueJson" JSONB,

    CONSTRAINT "inspection_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_assessments" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "rating" INTEGER,
    "condition" "ConditionStatus",
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_valuations" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "marketValue" DECIMAL(18,2),
    "forcedSaleValue" DECIMAL(18,2),
    "replacementCost" DECIMAL(18,2),
    "rentalEstimate" DECIMAL(18,2),
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_locations" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "altitudeM" DOUBLE PRECISION,
    "source" "LocationSource" NOT NULL DEFAULT 'GPS',
    "isMocked" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "distanceFromPropertyM" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "category" "PhotoCategory" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksumSha256" TEXT NOT NULL,
    "caption" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracyM" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "capturedById" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_comments" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "CommentType" NOT NULL DEFAULT 'REVIEWER_NOTE',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_status_events" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "fromStatus" "InspectionStatus",
    "toStatus" "InspectionStatus" NOT NULL,
    "actorId" TEXT,
    "comment" TEXT,
    "submissionRound" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_requests" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "targetSections" JSONB,
    "submissionRound" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_snapshots" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "submissionRound" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "administrative_divisions_organizationId_level_idx" ON "administrative_divisions"("organizationId", "level");

-- CreateIndex
CREATE INDEX "administrative_divisions_parentId_idx" ON "administrative_divisions"("parentId");

-- CreateIndex
CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organizationId_code_key" ON "branches"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_code_key" ON "roles"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE INDEX "inspection_templates_organizationId_idx" ON "inspection_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_organizationId_code_version_key" ON "inspection_templates"("organizationId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "template_sections_templateId_code_key" ON "template_sections"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "template_fields_sectionId_code_key" ON "template_fields"("sectionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "template_photo_rules_templateId_category_key" ON "template_photo_rules"("templateId", "category");

-- CreateIndex
CREATE INDEX "properties_organizationId_idx" ON "properties"("organizationId");

-- CreateIndex
CREATE INDEX "properties_branchId_idx" ON "properties"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "properties_organizationId_reference_key" ON "properties"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "inspections_organizationId_status_idx" ON "inspections"("organizationId", "status");

-- CreateIndex
CREATE INDEX "inspections_branchId_status_idx" ON "inspections"("branchId", "status");

-- CreateIndex
CREATE INDEX "inspections_inspectorId_status_idx" ON "inspections"("inspectorId", "status");

-- CreateIndex
CREATE INDEX "inspections_reviewerId_status_idx" ON "inspections"("reviewerId", "status");

-- CreateIndex
CREATE INDEX "inspections_submittedAt_idx" ON "inspections"("submittedAt");

-- CreateIndex
CREATE INDEX "inspections_loanReference_idx" ON "inspections"("loanReference");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_organizationId_inspectionNumber_key" ON "inspections"("organizationId", "inspectionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_clientRequestId_key" ON "inspections"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_owners_inspectionId_key" ON "inspection_owners"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_owners_nationalIdHash_idx" ON "inspection_owners"("nationalIdHash");

-- CreateIndex
CREATE INDEX "inspection_values_inspectionId_idx" ON "inspection_values"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_values_inspectionId_fieldId_key" ON "inspection_values"("inspectionId", "fieldId");

-- CreateIndex
CREATE INDEX "inspection_assessments_inspectionId_idx" ON "inspection_assessments"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_assessments_inspectionId_categoryCode_key" ON "inspection_assessments"("inspectionId", "categoryCode");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_valuations_inspectionId_key" ON "inspection_valuations"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_locations_inspectionId_idx" ON "inspection_locations"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_photos_inspectionId_category_idx" ON "inspection_photos"("inspectionId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_photos_clientRequestId_key" ON "inspection_photos"("clientRequestId");

-- CreateIndex
CREATE INDEX "inspection_comments_inspectionId_idx" ON "inspection_comments"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_status_events_inspectionId_createdAt_idx" ON "inspection_status_events"("inspectionId", "createdAt");

-- CreateIndex
CREATE INDEX "correction_requests_inspectionId_idx" ON "correction_requests"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_snapshots_inspectionId_submissionRound_key" ON "inspection_snapshots"("inspectionId", "submissionRound");

-- CreateIndex
CREATE INDEX "reports_inspectionId_idx" ON "reports"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_organizationId_reportNumber_version_key" ON "reports"("organizationId", "reportNumber", "version");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "administrative_divisions" ADD CONSTRAINT "administrative_divisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_divisions" ADD CONSTRAINT "administrative_divisions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "administrative_divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "administrative_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "template_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_photo_rules" ADD CONSTRAINT "template_photo_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "administrative_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_owners" ADD CONSTRAINT "inspection_owners_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_values" ADD CONSTRAINT "inspection_values_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_values" ADD CONSTRAINT "inspection_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "template_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_assessments" ADD CONSTRAINT "inspection_assessments_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_valuations" ADD CONSTRAINT "inspection_valuations_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_locations" ADD CONSTRAINT "inspection_locations_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "inspection_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_comments" ADD CONSTRAINT "inspection_comments_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_comments" ADD CONSTRAINT "inspection_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_status_events" ADD CONSTRAINT "inspection_status_events_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_status_events" ADD CONSTRAINT "inspection_status_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_snapshots" ADD CONSTRAINT "inspection_snapshots_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
