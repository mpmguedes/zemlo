-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "distanceUnit" TEXT NOT NULL DEFAULT 'km',
    "volumeUnit" TEXT NOT NULL DEFAULT 'l',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" DATETIME,
    "authProvider" TEXT,
    "authProviderId" TEXT,
    "avatarUrl" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorConfirmedAt" DATETIME,
    "recoveryCodeHashes" JSONB,
    "acceptedTermsAt" DATETIME,
    "termsVersion" TEXT,
    "lastLoginAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "reminderLeadDays" INTEGER NOT NULL DEFAULT 30,
    "reminderLeadKm" INTEGER NOT NULL DEFAULT 1000,
    "suggestionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "securityNudgeSnoozeDays" INTEGER NOT NULL DEFAULT 90,
    "frequentExpenseCategories" JSONB,
    "hiddenFields" JSONB,
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "digestFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'immediate',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "deviceLabel" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OneTimeToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OneTimeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "householdId" TEXT,
    "plate" TEXT NOT NULL,
    "plateDisplay" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "version" TEXT,
    "year" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'car',
    "fuelType" TEXT NOT NULL DEFAULT 'gasoline',
    "color" TEXT,
    "nickname" TEXT,
    "engineCode" TEXT,
    "powerCv" INTEGER,
    "engineDisplacementCc" INTEGER,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "batteryCapacityKwh" REAL,
    "usableBatteryKwh" REAL,
    "rangeKm" INTEGER,
    "tankCapacityL" REAL,
    "tyreSize" TEXT,
    "wheelSize" TEXT,
    "weightKg" INTEGER,
    "co2GKm" INTEGER,
    "purchaseDate" DATETIME,
    "purchasePriceCents" INTEGER,
    "purchaseOdometerKm" INTEGER,
    "registrationDate" DATETIME,
    "firstRegistrationDate" DATETIME,
    "odometerKm" INTEGER,
    "odometerSource" JSONB,
    "odometerUpdatedAt" DATETIME,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Vehicle_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OdometerReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "recordedAt" DATETIME NOT NULL,
    "source" JSONB,
    "notes" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "originRecordId" TEXT,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdometerReading_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vatCents" INTEGER,
    "category" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "vendor" TEXT,
    "odometerKm" INTEGER,
    "description" TEXT,
    "paymentMethod" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "linkedRecordType" TEXT,
    "linkedRecordId" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "litres" REAL NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "pricePerLitreCents" INTEGER,
    "odometerKm" INTEGER,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "fuelType" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "expenseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FuelSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FuelSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "energyKwh" REAL NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "pricePerKwhCents" INTEGER,
    "odometerKm" INTEGER,
    "location" TEXT,
    "charger" TEXT,
    "durationMinutes" INTEGER,
    "startSocPercent" REAL,
    "endSocPercent" REAL,
    "powerKw" REAL,
    "provider" TEXT,
    "tariff" TEXT,
    "isPublic" BOOLEAN,
    "isHome" BOOLEAN,
    "notes" TEXT,
    "source" JSONB,
    "expenseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChargingSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChargingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "amountCents" INTEGER,
    "partsCents" INTEGER,
    "labourCents" INTEGER,
    "workshop" TEXT,
    "description" TEXT,
    "warrantyMonths" INTEGER,
    "notes" TEXT,
    "nextDueDate" DATETIME,
    "nextDueOdometerKm" INTEGER,
    "source" JSONB,
    "expenseId" TEXT,
    "reminderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaintenanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "policyNumber" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "premiumCents" INTEGER,
    "coverage" TEXT,
    "deductibleCents" INTEGER,
    "contactPhone" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "reminderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InsurancePolicy_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InsurancePolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'passed',
    "odometerKm" INTEGER,
    "amountCents" INTEGER,
    "nextDueDate" DATETIME,
    "station" TEXT,
    "defects" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "reminderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'iuc',
    "year" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATETIME,
    "dueDate" DATETIME,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "documentId" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "reminderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaxRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaxRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date" DATETIME,
    "expiresAt" DATETIME,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "storageKey" TEXT,
    "notes" TEXT,
    "source" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'both',
    "dueDate" DATETIME,
    "dueOdometerKm" INTEGER,
    "intervalMonths" INTEGER,
    "intervalKm" INTEGER,
    "repeat" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "topic" TEXT NOT NULL DEFAULT 'maintenance',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "originRecordId" TEXT,
    "dedupeKey" TEXT,
    "source" JSONB,
    "completedAt" DATETIME,
    "previousReminderId" TEXT,
    "snoozedUntil" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "vehicleId" TEXT,
    "reminderId" TEXT,
    "dedupeKey" TEXT,
    "readAt" DATETIME,
    "scheduledFor" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SuggestionState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vehicleId" TEXT,
    "status" TEXT NOT NULL,
    "snoozedUntil" DATETIME,
    "shownCount" INTEGER NOT NULL DEFAULT 0,
    "lastShownAt" DATETIME,
    "actedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SuggestionState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "icon" TEXT,
    "amountCents" INTEGER,
    "odometerKm" INTEGER,
    "recordType" TEXT,
    "recordId" TEXT,
    "source" JSONB,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VehicleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "credentials" JSONB,
    "scopes" JSONB,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'never',
    "lastSyncMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Integration_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HomeAssistantEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "deviceClass" TEXT,
    "unitOfMeasurement" TEXT,
    "stateTopic" TEXT NOT NULL,
    "discoveryTopic" TEXT NOT NULL,
    "publishedState" JSONB,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "lastPublishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HomeAssistantEntity_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_authProvider_authProviderId_idx" ON "User"("authProvider", "authProviderId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_topic_channel_key" ON "NotificationPreference"("userId", "topic", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OneTimeToken_userId_purpose_idx" ON "OneTimeToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Vehicle_userId_archived_idx" ON "Vehicle"("userId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_userId_plate_key" ON "Vehicle"("userId", "plate");

-- CreateIndex
CREATE INDEX "OdometerReading_vehicleId_recordedAt_idx" ON "OdometerReading"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "OdometerReading_vehicleId_odometerKm_idx" ON "OdometerReading"("vehicleId", "odometerKm");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_date_idx" ON "Expense"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "Expense_userId_date_idx" ON "Expense"("userId", "date");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_category_idx" ON "Expense"("vehicleId", "category");

-- CreateIndex
CREATE INDEX "FuelSession_vehicleId_date_idx" ON "FuelSession"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "FuelSession_vehicleId_odometerKm_idx" ON "FuelSession"("vehicleId", "odometerKm");

-- CreateIndex
CREATE INDEX "ChargingSession_vehicleId_date_idx" ON "ChargingSession"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "ChargingSession_vehicleId_odometerKm_idx" ON "ChargingSession"("vehicleId", "odometerKm");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_vehicleId_date_idx" ON "MaintenanceRecord"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_vehicleId_type_idx" ON "MaintenanceRecord"("vehicleId", "type");

-- CreateIndex
CREATE INDEX "InsurancePolicy_vehicleId_endDate_idx" ON "InsurancePolicy"("vehicleId", "endDate");

-- CreateIndex
CREATE INDEX "InspectionRecord_vehicleId_date_idx" ON "InspectionRecord"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "InspectionRecord_vehicleId_nextDueDate_idx" ON "InspectionRecord"("vehicleId", "nextDueDate");

-- CreateIndex
CREATE INDEX "TaxRecord_vehicleId_year_idx" ON "TaxRecord"("vehicleId", "year");

-- CreateIndex
CREATE INDEX "Document_userId_category_idx" ON "Document"("userId", "category");

-- CreateIndex
CREATE INDEX "Document_vehicleId_expiresAt_idx" ON "Document"("vehicleId", "expiresAt");

-- CreateIndex
CREATE INDEX "Reminder_vehicleId_completedAt_idx" ON "Reminder"("vehicleId", "completedAt");

-- CreateIndex
CREATE INDEX "Reminder_userId_dueDate_idx" ON "Reminder"("userId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_vehicleId_dedupeKey_key" ON "Reminder"("vehicleId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SuggestionState_userId_status_idx" ON "SuggestionState"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionState_userId_key_key" ON "SuggestionState"("userId", "key");

-- CreateIndex
CREATE INDEX "VehicleEvent_vehicleId_date_idx" ON "VehicleEvent"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "VehicleEvent_userId_createdAt_idx" ON "VehicleEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleEvent_recordType_recordId_idx" ON "VehicleEvent"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "Integration_userId_category_idx" ON "Integration"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_userId_category_provider_vehicleId_key" ON "Integration"("userId", "category", "provider", "vehicleId");

-- CreateIndex
CREATE INDEX "HomeAssistantEntity_vehicleId_idx" ON "HomeAssistantEntity"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeAssistantEntity_integrationId_entityId_key" ON "HomeAssistantEntity"("integrationId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

