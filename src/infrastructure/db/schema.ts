import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const canonicalUnitEnum = pgEnum("canonical_unit", ["g", "ml", "pz"]);
export const versionStatusEnum = pgEnum("version_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);
export const checklistInputTypeEnum = pgEnum("checklist_input_type", [
  "BOOLEAN", "NUMBER", "TEXT", "SELECT", "TEMPERATURE", "WEIGHT", "TIME",
]);
export const checklistRunStatusEnum = pgEnum("checklist_run_status", ["OPEN", "COMPLETED", "CANCELLED"]);
export const checklistTaskStatusEnum = pgEnum("checklist_task_status", ["PENDING", "COMPLETED", "SKIPPED", "FAILED"]);
export const movementTypeEnum = pgEnum("inventory_movement_type", [
  "PURCHASE",
  "SALE",
  "WASTE",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "COUNT_ADJUSTMENT",
  "MANUAL_ADJUSTMENT",
  "OPENING_BALANCE",
]);
export const syncStatusEnum = pgEnum("sync_status", ["IDLE", "RUNNING", "SUCCESS", "FAILED"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["RECEIVED", "PROCESSING", "PROCESSED", "FAILED", "DUPLICATE"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  currencyCode: varchar("currency_code", { length: 3 }).notNull().default("MXN"),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  ...timestamps,
});

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: varchar("code", { length: 40 }).notNull(),
  storeType: varchar("store_type", { length: 40 }).notNull().default("CAFE"),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("stores_org_code_uidx").on(t.organizationId, t.code)]);

export const inventoryLocations = pgTable("inventory_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  locationType: varchar("location_type", { length: 40 }).notNull().default("STORAGE"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("inventory_locations_store_name_uidx").on(t.storeId, t.name)]);

// id mirrors Supabase auth.users.id. The FK is added in the SQL migration because auth.users is external to this schema.
export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  homeStoreId: uuid("home_store_id").references(() => stores.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  hireDate: timestamp("hire_date", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("employees_org_idx").on(t.organizationId)]);

export const employeeMessages = pgTable("employee_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
  recipientEmployeeId: uuid("recipient_employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  senderEmployeeId: uuid("sender_employee_id").references(() => employees.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  priority: varchar("priority", { length: 20 }).notNull().default("NORMAL"),
  readAt: timestamp("read_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("employee_messages_recipient_idx").on(t.recipientEmployeeId, t.readAt, t.createdAt),
  index("employee_messages_org_idx").on(t.organizationId, t.createdAt),
]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 60 }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystemRole: boolean("is_system_role").notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex("roles_org_code_uidx").on(t.organizationId, t.code)]);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const employeeRoles = pgTable("employee_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("employee_role_global_uidx").on(t.employeeId, t.roleId).where(sql`${t.storeId} is null`),
  uniqueIndex("employee_role_store_uidx").on(t.employeeId, t.roleId, t.storeId).where(sql`${t.storeId} is not null`),
  index("employee_roles_role_idx").on(t.roleId),
  index("employee_roles_store_idx").on(t.storeId),
]);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sku: varchar("sku", { length: 100 }),
  category: varchar("category", { length: 80 }).notNull(),
  canonicalUnit: canonicalUnitEnum("canonical_unit").notNull(),
  trackingType: varchar("tracking_type", { length: 40 }).notNull().default("QUANTITY"),
  minimumStock: numeric("minimum_stock", { precision: 18, scale: 3 }),
  densityGPerMl: numeric("density_g_per_ml", { precision: 12, scale: 6 }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [
  index("inventory_items_org_idx").on(t.organizationId),
  uniqueIndex("inventory_items_org_sku_uidx").on(t.organizationId, t.sku),
]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  city: text("city"),
  contact: text("contact"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const itemPurchaseUnits = pgTable("item_purchase_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  supplierSku: text("supplier_sku"),
  canonicalQuantity: numeric("canonical_quantity", { precision: 18, scale: 3 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sizeOz: numeric("size_oz", { precision: 6, scale: 2 }),
  temperature: varchar("temperature", { length: 20 }),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  productVariantId: uuid("product_variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  currentVersionId: uuid("current_version_id"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const recipeVersions = pgTable("recipe_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  majorVersion: integer("major_version").notNull(),
  minorVersion: integer("minor_version").notNull(),
  status: versionStatusEnum("status").notNull().default("DRAFT"),
  yieldQuantity: numeric("yield_quantity", { precision: 18, scale: 3 }),
  yieldUnit: canonicalUnitEnum("yield_unit"),
  instructions: text("instructions").notNull(),
  presentationSpec: jsonb("presentation_spec").$type<Record<string, unknown>>().notNull().default({}),
  qualitySpec: jsonb("quality_spec").$type<Record<string, unknown>>().notNull().default({}),
  referenceImagePath: text("reference_image_path"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => userProfiles.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => userProfiles.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("recipe_version_uidx").on(t.recipeId, t.majorVersion, t.minorVersion)]);

export const recipeComponents = pgTable("recipe_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  recipeVersionId: uuid("recipe_version_id").notNull().references(() => recipeVersions.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
  wasteFactor: numeric("waste_factor", { precision: 8, scale: 6 }).notNull().default("0"),
  sequence: integer("sequence").notNull().default(0),
  notes: text("notes"),
});

export const itemCostHistory = pgTable("item_cost_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  costPerCanonicalUnit: numeric("cost_per_canonical_unit", { precision: 18, scale: 8 }).notNull(),
  source: varchar("source", { length: 60 }).notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => userProfiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("item_cost_history_lookup_idx").on(t.inventoryItemId, t.effectiveFrom)]);

export const sops = pgTable("sops", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  currentVersionId: uuid("current_version_id"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const sopVersions = pgTable("sop_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sopId: uuid("sop_id").notNull().references(() => sops.id, { onDelete: "cascade" }),
  majorVersion: integer("major_version").notNull(),
  minorVersion: integer("minor_version").notNull(),
  status: versionStatusEnum("status").notNull().default("DRAFT"),
  content: text("content").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => userProfiles.id, { onDelete: "set null" }),
  approvedBy: uuid("approved_by").references(() => userProfiles.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [uniqueIndex("sop_version_uidx").on(t.sopId, t.majorVersion, t.minorVersion)]);

export const checklistTemplates = pgTable("checklist_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shiftType: varchar("shift_type", { length: 40 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const checklistTasks = pgTable("checklist_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  checklistTemplateId: uuid("checklist_template_id").notNull().references(() => checklistTemplates.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  area: varchar("area", { length: 60 }).notNull(),
  priority: varchar("priority", { length: 40 }).notNull().default("NORMAL"),
  isRequired: boolean("is_required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  inputType: checklistInputTypeEnum("input_type").notNull().default("BOOLEAN"),
  minValue: numeric("min_value", { precision: 18, scale: 3 }),
  maxValue: numeric("max_value", { precision: 18, scale: 3 }),
  targetDurationSeconds: integer("target_duration_seconds"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  assignedRoleId: uuid("assigned_role_id").references(() => roles.id, { onDelete: "set null" }),
  sopId: uuid("sop_id").references(() => sops.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const checklistTaskSchedules = pgTable("checklist_task_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  checklistTaskId: uuid("checklist_task_id").notNull().references(() => checklistTasks.id, { onDelete: "cascade" }),
  rrule: text("rrule").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const checklistRuns = pgTable("checklist_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  checklistTemplateId: uuid("checklist_template_id").notNull().references(() => checklistTemplates.id, { onDelete: "restrict" }),
  businessDate: varchar("business_date", { length: 10 }).notNull(),
  shiftType: varchar("shift_type", { length: 40 }).notNull(),
  status: checklistRunStatusEnum("status").notNull().default("OPEN"),
  startedByEmployeeId: uuid("started_by_employee_id").references(() => employees.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("checklist_runs_store_date_idx").on(t.storeId, t.businessDate),
  uniqueIndex("checklist_runs_daily_uidx").on(t.storeId, t.checklistTemplateId, t.businessDate)]);

export const checklistRunTasks = pgTable("checklist_run_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  checklistRunId: uuid("checklist_run_id").notNull().references(() => checklistRuns.id, { onDelete: "cascade" }),
  sourceTaskId: uuid("source_task_id").references(() => checklistTasks.id, { onDelete: "set null" }),
  titleSnapshot: text("title_snapshot").notNull(),
  descriptionSnapshot: text("description_snapshot"),
  requiredSnapshot: boolean("required_snapshot").notNull(),
  inputTypeSnapshot: checklistInputTypeEnum("input_type_snapshot").notNull(),
  targetDurationSecondsSnapshot: integer("target_duration_seconds_snapshot"),
  sopVersionId: uuid("sop_version_id").references(() => sopVersions.id, { onDelete: "set null" }),
  status: checklistTaskStatusEnum("status").notNull().default("PENDING"),
  startedByEmployeeId: uuid("started_by_employee_id").references(() => employees.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedByEmployeeId: uuid("completed_by_employee_id").references(() => employees.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  numericValue: numeric("numeric_value", { precision: 18, scale: 3 }),
  textValue: text("text_value"),
  booleanValue: boolean("boolean_value"),
  comment: text("comment"),
  validationStatus: varchar("validation_status", { length: 40 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const espressoQualityChecks = pgTable("espresso_quality_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
  recipeVersionId: uuid("recipe_version_id").references(() => recipeVersions.id, { onDelete: "set null" }),
  roastBatchId: uuid("roast_batch_id"),
  doseG: numeric("dose_g", { precision: 8, scale: 3 }).notNull(),
  yieldG: numeric("yield_g", { precision: 8, scale: 3 }).notNull(),
  brewTimeS: numeric("brew_time_s", { precision: 8, scale: 2 }).notNull(),
  sensoryRating: varchar("sensory_rating", { length: 40 }).notNull(),
  sensoryNotes: text("sensory_notes"),
  withinTimeSpec: boolean("within_time_spec").notNull(),
  withinYieldSpec: boolean("within_yield_spec"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roastCoffeeLots = pgTable("roast_coffee_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  origin: text("origin"),
  farm: text("farm"),
  producer: text("producer"),
  variety: text("variety"),
  process: text("process"),
  altitudeMasl: integer("altitude_masl"),
  targetUse: varchar("target_use", { length: 30 }).notNull().default("OMNI"),
  greenInventoryItemId: uuid("green_inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
  roastedInventoryItemId: uuid("roasted_inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
  loyverseRoastedVariantExternalId: text("loyverse_roasted_variant_external_id"),
  loyverseUnitToG: numeric("loyverse_unit_to_g", { precision: 18, scale: 6 }).notNull().default("1000"),
  greenCostPerKg: numeric("green_cost_per_kg", { precision: 14, scale: 2 }),
  densityGPerL: numeric("density_g_per_l", { precision: 10, scale: 2 }),
  moisturePct: numeric("moisture_pct", { precision: 6, scale: 3 }),
  minRestDays: integer("min_rest_days").notNull().default(4),
  peakRestDays: integer("peak_rest_days").notNull().default(10),
  maxRestDays: integer("max_rest_days").notNull().default(30),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [
  index("roast_coffee_lots_org_idx").on(t.organizationId, t.isActive),
  index("roast_coffee_lots_loyverse_idx").on(t.organizationId, t.loyverseRoastedVariantExternalId),
]);

export const roastProfiles = pgTable("roast_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  coffeeLotId: uuid("coffee_lot_id").references(() => roastCoffeeLots.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  roasterName: text("roaster_name").notNull().default("Skywalker v1"),
  targetUse: varchar("target_use", { length: 30 }).notNull().default("OMNI"),
  batchSizeG: numeric("batch_size_g", { precision: 10, scale: 2 }),
  chargeTempC: numeric("charge_temp_c", { precision: 7, scale: 2 }),
  targetYellowingS: integer("target_yellowing_s"),
  targetFirstCrackS: integer("target_first_crack_s"),
  targetDropS: integer("target_drop_s"),
  targetFirstCrackTempC: numeric("target_first_crack_temp_c", { precision: 7, scale: 2 }),
  targetDropTempC: numeric("target_drop_temp_c", { precision: 7, scale: 2 }),
  targetDtrPct: numeric("target_dtr_pct", { precision: 6, scale: 2 }),
  dtrTolerancePct: numeric("dtr_tolerance_pct", { precision: 6, scale: 2 }).notNull().default("2"),
  targetWeightLossPct: numeric("target_weight_loss_pct", { precision: 6, scale: 2 }),
  weightLossTolerancePct: numeric("weight_loss_tolerance_pct", { precision: 6, scale: 2 }).notNull().default("2"),
  timeToleranceS: integer("time_tolerance_s").notNull().default(20),
  powerPlan: jsonb("power_plan").$type<Array<Record<string, unknown>>>().notNull().default([]),
  fanPlan: jsonb("fan_plan").$type<Array<Record<string, unknown>>>().notNull().default([]),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [
  index("roast_profiles_lot_idx").on(t.coffeeLotId, t.isActive),
]);

export const roastBatches = pgTable("roast_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  coffeeLotId: uuid("coffee_lot_id").notNull().references(() => roastCoffeeLots.id, { onDelete: "restrict" }),
  profileId: uuid("profile_id").references(() => roastProfiles.id, { onDelete: "set null" }),
  batchCode: varchar("batch_code", { length: 80 }).notNull(),
  roasterName: text("roaster_name").notNull().default("Skywalker v1"),
  roastedAt: timestamp("roasted_at", { withTimezone: true }).notNull(),
  operatorEmployeeId: uuid("operator_employee_id").references(() => employees.id, { onDelete: "set null" }),
  greenWeightG: numeric("green_weight_g", { precision: 10, scale: 2 }).notNull(),
  roastedWeightG: numeric("roasted_weight_g", { precision: 10, scale: 2 }).notNull(),
  weightLossPct: numeric("weight_loss_pct", { precision: 7, scale: 3 }).notNull(),
  chargeTempC: numeric("charge_temp_c", { precision: 7, scale: 2 }),
  turningPointTimeS: integer("turning_point_time_s"),
  turningPointTempC: numeric("turning_point_temp_c", { precision: 7, scale: 2 }),
  yellowingTimeS: integer("yellowing_time_s"),
  yellowingTempC: numeric("yellowing_temp_c", { precision: 7, scale: 2 }),
  firstCrackTimeS: integer("first_crack_time_s"),
  firstCrackTempC: numeric("first_crack_temp_c", { precision: 7, scale: 2 }),
  dropTimeS: integer("drop_time_s"),
  dropTempC: numeric("drop_temp_c", { precision: 7, scale: 2 }),
  developmentTimeS: integer("development_time_s"),
  dtrPct: numeric("dtr_pct", { precision: 7, scale: 3 }),
  curveData: jsonb("curve_data").$type<Array<{ tS: number; btC?: number; etC?: number; rorCMin?: number; powerPct?: number; fanPct?: number }>>().notNull().default([]),
  status: varchar("status", { length: 30 }).notNull().default("ROASTED"),
  inventoryPosted: boolean("inventory_posted").notNull().default(false),
  notes: text("notes"),
  ...timestamps,
}, (t) => [
  uniqueIndex("roast_batches_code_uidx").on(t.organizationId, t.batchCode),
  index("roast_batches_lot_date_idx").on(t.coffeeLotId, t.roastedAt),
  index("roast_batches_profile_idx").on(t.profileId, t.roastedAt),
]);

export const roastSensoryEvaluations = pgTable("roast_sensory_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roastBatchId: uuid("roast_batch_id").notNull().references(() => roastBatches.id, { onDelete: "cascade" }),
  evaluatorEmployeeId: uuid("evaluator_employee_id").references(() => employees.id, { onDelete: "set null" }),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  brewMethod: varchar("brew_method", { length: 40 }).notNull().default("CUPPING"),
  aroma: numeric("aroma", { precision: 4, scale: 1 }),
  acidity: numeric("acidity", { precision: 4, scale: 1 }),
  sweetness: numeric("sweetness", { precision: 4, scale: 1 }),
  body: numeric("body", { precision: 4, scale: 1 }),
  bitterness: numeric("bitterness", { precision: 4, scale: 1 }),
  aftertaste: numeric("aftertaste", { precision: 4, scale: 1 }),
  balance: numeric("balance", { precision: 4, scale: 1 }),
  overallScore: numeric("overall_score", { precision: 5, scale: 2 }),
  descriptors: text("descriptors"),
  defects: text("defects"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("roast_sensory_batch_idx").on(t.roastBatchId, t.evaluatedAt),
]);

export const roastBarAssignments = pgTable("roast_bar_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  roastBatchId: uuid("roast_batch_id").notNull().references(() => roastBatches.id, { onDelete: "cascade" }),
  barRole: varchar("bar_role", { length: 30 }).notNull().default("ESPRESSO"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  assignedByEmployeeId: uuid("assigned_by_employee_id").references(() => employees.id, { onDelete: "set null" }),
  note: text("note"),
  ...timestamps,
}, (t) => [
  index("roast_bar_assignments_store_idx").on(t.storeId, t.barRole, t.isActive),
  index("roast_bar_assignments_batch_idx").on(t.roastBatchId, t.isActive),
]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  movementType: movementTypeEnum("movement_type").notNull(),
  quantityDelta: numeric("quantity_delta", { precision: 18, scale: 3 }).notNull(),
  sourceType: varchar("source_type", { length: 60 }).notNull(),
  sourceId: text("source_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
  note: text("note"),
  externalProvider: varchar("external_provider", { length: 40 }),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("inventory_movements_balance_idx").on(t.storeId, t.locationId, t.inventoryItemId, t.occurredAt),
  uniqueIndex("inventory_movements_external_uidx").on(t.externalProvider, t.externalId, t.inventoryItemId, t.locationId),
]);

export const inventoryBalances = pgTable("inventory_balances", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  theoreticalQuantity: numeric("theoretical_quantity", { precision: 18, scale: 3 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.storeId, t.locationId, t.inventoryItemId] })]);

export const inventoryCounts = pgTable("inventory_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 30 }).notNull().default("OPEN"),
  startedBy: uuid("started_by").references(() => employees.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedBy: uuid("completed_by").references(() => employees.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
});

export const inventoryCountLines = pgTable("inventory_count_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  inventoryCountId: uuid("inventory_count_id").notNull().references(() => inventoryCounts.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  theoreticalQuantitySnapshot: numeric("theoretical_quantity_snapshot", { precision: 18, scale: 3 }).notNull(),
  physicalQuantity: numeric("physical_quantity", { precision: 18, scale: 3 }).notNull(),
  deviationQuantity: numeric("deviation_quantity", { precision: 18, scale: 3 }).notNull(),
  deviationPercentage: numeric("deviation_percentage", { precision: 12, scale: 6 }),
  adjustmentMovementId: uuid("adjustment_movement_id").references(() => inventoryMovements.id, { onDelete: "set null" }),
  countedBy: uuid("counted_by").references(() => employees.id, { onDelete: "set null" }),
  countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("inventory_count_item_uidx").on(t.inventoryCountId, t.inventoryItemId)]);

export const shortageReports = pgTable("shortage_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
  reportedBy: uuid("reported_by").references(() => employees.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantityNeeded: numeric("quantity_needed", { precision: 18, scale: 3 }),
  unit: varchar("unit", { length: 20 }),
  priority: varchar("priority", { length: 20 }).notNull().default("NORMAL"),
  status: varchar("status", { length: 20 }).notNull().default("OPEN"),
  note: text("note"),
  resolvedBy: uuid("resolved_by").references(() => employees.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("shortage_reports_store_status_idx").on(t.storeId, t.status, t.createdAt),
  index("shortage_reports_org_idx").on(t.organizationId),
  index("shortage_reports_item_idx").on(t.inventoryItemId),
  index("shortage_reports_reported_by_idx").on(t.reportedBy),
  index("shortage_reports_resolved_by_idx").on(t.resolvedBy),
]);

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 40 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("DISCONNECTED"),
  externalAccountId: text("external_account_id"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (t) => [uniqueIndex("integration_org_provider_uidx").on(t.organizationId, t.provider)]);

export const syncStates = pgTable("sync_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  integrationConnectionId: uuid("integration_connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  resource: varchar("resource", { length: 80 }).notNull(),
  cursor: text("cursor"),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  status: syncStatusEnum("status").notNull().default("IDLE"),
  errorMessage: text("error_message"),
  ...timestamps,
}, (t) => [uniqueIndex("sync_state_resource_uidx").on(t.integrationConnectionId, t.resource)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  integrationConnectionId: uuid("integration_connection_id").notNull().references(() => integrationConnections.id, { onDelete: "cascade" }),
  resource: varchar("resource", { length: 80 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsRead: integer("records_read").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  status: syncStatusEnum("status").notNull().default("RUNNING"),
  error: text("error"),
});

export const loyverseStores = pgTable("loyverse_stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_stores_external_uidx").on(t.organizationId, t.externalId)]);

export const loyverseCategories = pgTable("loyverse_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_categories_external_uidx").on(t.organizationId, t.externalId)]);

export const loyverseItems = pgTable("loyverse_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  itemName: text("item_name").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_items_external_uidx").on(t.organizationId, t.externalId)]);

export const loyverseVariants = pgTable("loyverse_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  loyverseItemExternalId: text("loyverse_item_external_id"),
  variantName: text("variant_name"),
  sku: text("sku"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_variants_external_uidx").on(t.organizationId, t.externalId)]);

export const loyverseInventoryLevels = pgTable("loyverse_inventory_levels", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  variantExternalId: text("variant_external_id").notNull(),
  storeExternalId: text("store_external_id").notNull(),
  inStock: numeric("in_stock", { precision: 18, scale: 3 }).notNull(),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.variantExternalId, t.storeExternalId] })]);

export const loyverseInventorySnapshots = pgTable("loyverse_inventory_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  variantExternalId: text("variant_external_id").notNull(),
  storeExternalId: text("store_external_id").notNull(),
  inStock: numeric("in_stock", { precision: 18, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 4 }),
  lowStock: numeric("low_stock", { precision: 18, scale: 3 }),
  optimalStock: numeric("optimal_stock", { precision: 18, scale: 3 }),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("loyverse_inventory_snapshots_lookup_idx").on(
    t.organizationId,
    t.storeExternalId,
    t.variantExternalId,
    t.capturedAt,
  ),
  index("loyverse_inventory_snapshots_captured_idx").on(
    t.organizationId,
    t.capturedAt,
  ),
]);

export const loyverseItemSettings = pgTable("loyverse_item_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  variantExternalId: text("variant_external_id").notNull(),
  displayUnit: varchar("display_unit", { length: 20 }),
  displayFactor: numeric("display_factor", { precision: 18, scale: 6 }).notNull().default("1"),
  unitCostOverride: numeric("unit_cost_override", { precision: 14, scale: 4 }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  packageName: text("package_name"),
  packageQuantityNative: numeric("package_quantity_native", { precision: 18, scale: 3 }),
  packagePrice: numeric("package_price", { precision: 14, scale: 2 }),
  leadDays: integer("lead_days").notNull().default(0),
  safetyDays: integer("safety_days").notNull().default(3),
  notes: text("notes"),
  ...timestamps,
}, (t) => [
  uniqueIndex("loyverse_item_settings_variant_uidx").on(
    t.organizationId,
    t.variantExternalId,
  ),
  index("loyverse_item_settings_supplier_idx").on(t.supplierId),
]);

export const purchasePlans = pgTable("purchase_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  destination: text("destination"),
  plannedFor: timestamp("planned_for", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
  notes: text("notes"),
  estimatedBudget: numeric("estimated_budget", { precision: 14, scale: 2 }),
  actualSpend: numeric("actual_spend", { precision: 14, scale: 2 }),
  createdBy: uuid("created_by").references(() => userProfiles.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [
  index("purchase_plans_org_status_idx").on(t.organizationId, t.status),
  index("purchase_plans_date_idx").on(t.organizationId, t.plannedFor),
]);

export const purchasePlanLines = pgTable("purchase_plan_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  purchasePlanId: uuid("purchase_plan_id").notNull().references(() => purchasePlans.id, { onDelete: "cascade" }),
  variantExternalId: text("variant_external_id"),
  itemNameSnapshot: text("item_name_snapshot").notNull(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  requestedNativeQuantity: numeric("requested_native_quantity", { precision: 18, scale: 3 }),
  packageCount: numeric("package_count", { precision: 18, scale: 3 }),
  packageNameSnapshot: text("package_name_snapshot"),
  packageQuantitySnapshot: numeric("package_quantity_snapshot", { precision: 18, scale: 3 }),
  unitCostSnapshot: numeric("unit_cost_snapshot", { precision: 14, scale: 4 }),
  packagePriceSnapshot: numeric("package_price_snapshot", { precision: 14, scale: 2 }),
  estimatedTotal: numeric("estimated_total", { precision: 14, scale: 2 }),
  actualTotal: numeric("actual_total", { precision: 14, scale: 2 }),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  note: text("note"),
  ...timestamps,
}, (t) => [
  index("purchase_plan_lines_plan_idx").on(t.purchasePlanId),
  index("purchase_plan_lines_variant_idx").on(t.organizationId, t.variantExternalId),
]);

export const loyverseReceipts = pgTable("loyverse_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  storeExternalId: text("store_external_id"),
  receiptType: varchar("receipt_type", { length: 40 }),
  totalMoney: numeric("total_money", { precision: 14, scale: 2 }),
  receiptDate: timestamp("receipt_date", { withTimezone: true }),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_receipts_external_uidx").on(t.organizationId, t.externalId)]);

export const loyverseReceiptLines = pgTable("loyverse_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  receiptExternalId: text("receipt_external_id").notNull(),
  lineExternalId: text("line_external_id"),
  variantExternalId: text("variant_external_id"),
  quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
  grossTotalMoney: numeric("gross_total_money", { precision: 14, scale: 2 }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
}, (t) => [index("loyverse_receipt_lines_receipt_idx").on(t.organizationId, t.receiptExternalId)]);

export const loyverseCustomers = pgTable("loyverse_customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  externalUpdatedAt: timestamp("external_updated_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("loyverse_customers_external_uidx").on(t.organizationId, t.externalId)]);

export const externalEntityMappings = pgTable("external_entity_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 40 }).notNull(),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  externalId: text("external_id").notNull(),
  internalId: uuid("internal_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("external_mapping_uidx").on(t.organizationId, t.provider, t.entityType, t.externalId)]);

export const loyverseInventoryMappings = pgTable("loyverse_inventory_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  loyverseStoreExternalId: text("loyverse_store_external_id").notNull(),
  loyverseVariantExternalId: text("loyverse_variant_external_id").notNull(),
  sourceMode: varchar("source_mode", { length: 20 }).notNull().default("UNIT"),
  sourceUnit: varchar("source_unit", { length: 20 }).notNull().default("pz"),
  factorToCanonical: numeric("factor_to_canonical", { precision: 18, scale: 6 }).notNull().default("1"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [
  uniqueIndex("loyverse_inventory_mapping_variant_uidx").on(
    t.organizationId,
    t.storeId,
    t.loyverseStoreExternalId,
    t.loyverseVariantExternalId,
  ),
  uniqueIndex("loyverse_inventory_mapping_balance_uidx").on(
    t.storeId,
    t.locationId,
    t.inventoryItemId,
  ),
  index("loyverse_inventory_mapping_item_idx").on(t.inventoryItemId),
  index("loyverse_inventory_mapping_location_idx").on(t.locationId),
]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 40 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  externalEventKey: text("external_event_key").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  status: webhookStatusEnum("status").notNull().default("RECEIVED"),
  attemptCount: integer("attempt_count").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [uniqueIndex("webhook_event_dedupe_uidx").on(t.provider, t.externalEventKey)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  actorEmployeeId: uuid("actor_employee_id").references(() => employees.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: text("entity_id").notNull(),
  beforeData: jsonb("before_data").$type<Record<string, unknown>>(),
  afterData: jsonb("after_data").$type<Record<string, unknown>>(),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt)]);
