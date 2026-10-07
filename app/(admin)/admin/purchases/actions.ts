"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  loyverseItemSettings,
  purchasePlanLines,
  purchasePlans,
  stores,
  suppliers,
} from "@/src/infrastructure/db/schema";

const optionalNumber = z.preprocess(
  (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? undefined : Number(text);
  },
  z.number().nonnegative().optional(),
);

export async function createSupplier(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const contact = String(formData.get("contact") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name || name.length > 150) {
    redirect("/admin/purchases?error=supplier");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("purchase.manage");
  const db = getDb();

  const [created] = await db
    .insert(suppliers)
    .values({
      organizationId,
      name,
      city,
      contact,
      notes,
    })
    .returning({ id: suppliers.id });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "SUPPLIER_CREATED",
    entityType: "supplier",
    entityId: created.id,
    afterData: { name, city, contact, notes },
  });

  revalidatePath("/admin/purchases");
  redirect("/admin/purchases?supplier=created");
}

const settingSchema = z.object({
  variantExternalId: z.string().min(1),
  displayUnit: z.enum(["g", "ml", "pz", "kg", "L"]).optional(),
  displayFactor: optionalNumber,
  unitCostOverride: optionalNumber,
  supplierId: z.string().uuid().optional(),
  packageName: z.string().trim().max(120).optional(),
  packageQuantityNative: optionalNumber,
  packagePrice: optionalNumber,
  leadDays: z.coerce.number().int().min(0).max(60),
  safetyDays: z.coerce.number().int().min(0).max(60),
  notes: z.string().trim().max(500).optional(),
});

export async function saveLoyverseItemSetting(formData: FormData) {
  const rawSupplier = String(formData.get("supplierId") ?? "").trim();
  const rawDisplayUnit = String(formData.get("displayUnit") ?? "").trim();

  const parsed = settingSchema.safeParse({
    variantExternalId: String(formData.get("variantExternalId") ?? ""),
    displayUnit: rawDisplayUnit || undefined,
    displayFactor: formData.get("displayFactor"),
    unitCostOverride: formData.get("unitCostOverride"),
    supplierId: rawSupplier || undefined,
    packageName: String(formData.get("packageName") ?? "") || undefined,
    packageQuantityNative: formData.get("packageQuantityNative"),
    packagePrice: formData.get("packagePrice"),
    leadDays: formData.get("leadDays") ?? 0,
    safetyDays: formData.get("safetyDays") ?? 3,
    notes: String(formData.get("notes") ?? "") || undefined,
  });

  if (!parsed.success) {
    redirect("/admin/purchases?error=item-setting");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("purchase.manage");
  const db = getDb();
  const data = parsed.data;

  await db
    .insert(loyverseItemSettings)
    .values({
      organizationId,
      variantExternalId: data.variantExternalId,
      displayUnit: data.displayUnit ?? null,
      displayFactor: String(data.displayFactor ?? 1),
      unitCostOverride:
        data.unitCostOverride == null
          ? null
          : String(data.unitCostOverride),
      supplierId: data.supplierId ?? null,
      packageName: data.packageName ?? null,
      packageQuantityNative:
        data.packageQuantityNative == null
          ? null
          : String(data.packageQuantityNative),
      packagePrice:
        data.packagePrice == null ? null : String(data.packagePrice),
      leadDays: data.leadDays,
      safetyDays: data.safetyDays,
      notes: data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        loyverseItemSettings.organizationId,
        loyverseItemSettings.variantExternalId,
      ],
      set: {
        displayUnit: data.displayUnit ?? null,
        displayFactor: String(data.displayFactor ?? 1),
        unitCostOverride:
          data.unitCostOverride == null
            ? null
            : String(data.unitCostOverride),
        supplierId: data.supplierId ?? null,
        packageName: data.packageName ?? null,
        packageQuantityNative:
          data.packageQuantityNative == null
            ? null
            : String(data.packageQuantityNative),
        packagePrice:
          data.packagePrice == null ? null : String(data.packagePrice),
        leadDays: data.leadDays,
        safetyDays: data.safetyDays,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      },
    });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "LOYVERSE_ITEM_SETTING_SAVED",
    entityType: "loyverse_variant",
    entityId: data.variantExternalId,
    afterData: data,
  });

  revalidatePath("/admin/purchases");
  revalidatePath("/inventory");
  revalidatePath("/recipes");
  revalidatePath("/admin/loyverse/recipes");
  redirect("/admin/purchases?setting=saved");
}

export async function generateSuggestedPurchasePlan(formData: FormData) {
  const titleInput = String(formData.get("title") ?? "").trim();
  const destination =
    String(formData.get("destination") ?? "").trim() || "Puebla";
  const plannedForRaw =
    String(formData.get("plannedFor") ?? "").trim() || null;

  const { user, employeeId, organizationId } =
    await requirePermission("purchase.manage");
  const db = getDb();
  const intelligence = await getInventoryIntelligence(organizationId);

  const rows = intelligence.smartRows.filter(
    (row) => row.suggestedPurchase > 0.0005,
  );

  if (rows.length === 0) {
    redirect("/admin/purchases?error=no-purchases");
  }

  const [homeStore] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(
        eq(stores.organizationId, organizationId),
        eq(stores.isActive, true),
      ),
    )
    .limit(1);

  const earliestAutoDate = rows
    .map((row) => row.orderDate)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  const plannedFor = plannedForRaw
    ? new Date(plannedForRaw + "T12:00:00-06:00")
    : earliestAutoDate
      ? new Date(earliestAutoDate + "T12:00:00-06:00")
      : new Date();

  const title =
    titleInput ||
    `Compra ${destination} · ${plannedFor.toLocaleDateString("es-MX", {
      timeZone: "America/Mexico_City",
    })}`;

  const estimatedBudget = rows.reduce(
    (sum, row) => sum + (row.suggestedCost ?? 0),
    0,
  );

  const planId = await db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(purchasePlans)
      .values({
        organizationId,
        storeId: homeStore?.id ?? null,
        title,
        destination,
        plannedFor,
        status: "DRAFT",
        estimatedBudget: String(estimatedBudget),
        createdBy: user.id,
        notes:
          "Generada desde cobertura, consumo de recetas y existencia Loyverse.",
      })
      .returning({ id: purchasePlans.id });

    await tx.insert(purchasePlanLines).values(
      rows.map((row) => ({
        organizationId,
        purchasePlanId: plan.id,
        variantExternalId: row.variantExternalId,
        itemNameSnapshot: row.itemName,
        supplierId: row.supplierId,
        requestedNativeQuantity: String(row.suggestedPurchase),
        packageCount:
          row.suggestedPackages == null
            ? null
            : String(row.suggestedPackages),
        packageNameSnapshot: row.packageName,
        packageQuantitySnapshot:
          row.packageQuantityNative == null
            ? null
            : String(row.packageQuantityNative),
        unitCostSnapshot:
          row.purchaseCost == null ? null : String(row.purchaseCost),
        packagePriceSnapshot:
          row.packagePrice == null ? null : String(row.packagePrice),
        estimatedTotal:
          row.suggestedCost == null ? null : String(row.suggestedCost),
        note:
          row.orderDate != null
            ? `Comprar a más tardar: ${row.orderDate}`
            : null,
      })),
    );

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "PURCHASE_PLAN_GENERATED",
      entityType: "purchase_plan",
      entityId: plan.id,
      afterData: {
        title,
        destination,
        plannedFor: plannedFor.toISOString(),
        lines: rows.length,
        estimatedBudget,
      },
    });

    return plan.id;
  });

  revalidatePath("/admin/purchases");
  redirect(`/admin/purchases?plan=${planId}`);
}

export async function updatePurchasePlan(formData: FormData) {
  const planId = String(formData.get("planId") ?? "");
  const status = String(formData.get("status") ?? "");
  const actualSpendRaw = String(formData.get("actualSpend") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (
    !planId ||
    !["DRAFT", "PLANNED", "PURCHASED", "CANCELLED"].includes(status)
  ) {
    redirect("/admin/purchases?error=plan");
  }

  const actualSpend = actualSpendRaw ? Number(actualSpendRaw) : null;
  if (
    actualSpend != null &&
    (!Number.isFinite(actualSpend) || actualSpend < 0)
  ) {
    redirect("/admin/purchases?error=plan");
  }

  const { user, employeeId, organizationId } =
    await requirePermission("purchase.manage");
  const db = getDb();

  await db
    .update(purchasePlans)
    .set({
      status,
      actualSpend: actualSpend == null ? null : String(actualSpend),
      notes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(purchasePlans.id, planId),
        eq(purchasePlans.organizationId, organizationId),
      ),
    );

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "PURCHASE_PLAN_UPDATED",
    entityType: "purchase_plan",
    entityId: planId,
    afterData: { status, actualSpend, notes },
  });

  revalidatePath("/admin/purchases");
}

export async function togglePurchaseLine(formData: FormData) {
  const lineId = String(formData.get("lineId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!lineId || !["PENDING", "BOUGHT", "SKIPPED"].includes(status)) {
    return;
  }

  const { organizationId } =
    await requirePermission("purchase.manage");
  await getDb()
    .update(purchasePlanLines)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(purchasePlanLines.id, lineId),
        eq(purchasePlanLines.organizationId, organizationId),
      ),
    );

  revalidatePath("/admin/purchases");
}
