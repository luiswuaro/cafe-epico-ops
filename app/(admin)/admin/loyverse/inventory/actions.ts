"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { syncLoyverseInventory } from "@/src/application/loyverse/sync";
import { postInventoryMovement } from "@/src/application/inventory/post-movement";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  inventoryBalances,
  inventoryItems,
  inventoryLocations,
  loyverseInventoryLevels,
  loyverseInventoryMappings,
  loyverseItems,
  loyverseStores,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

const presetSchema = z.enum([
  "PIECE",
  "KG_TO_G",
  "G_TO_G",
  "L_TO_ML",
  "ML_TO_ML",
]);

function presetConfig(preset: z.infer<typeof presetSchema>) {
  switch (preset) {
    case "PIECE":
      return {
        sourceMode: "UNIT",
        sourceUnit: "pz",
        factorToCanonical: "1",
        canonicalUnit: "pz" as const,
      };
    case "KG_TO_G":
      return {
        sourceMode: "FRACTIONAL",
        sourceUnit: "kg",
        factorToCanonical: "1000",
        canonicalUnit: "g" as const,
      };
    case "G_TO_G":
      return {
        sourceMode: "FRACTIONAL",
        sourceUnit: "g",
        factorToCanonical: "1",
        canonicalUnit: "g" as const,
      };
    case "L_TO_ML":
      return {
        sourceMode: "FRACTIONAL",
        sourceUnit: "L",
        factorToCanonical: "1000",
        canonicalUnit: "ml" as const,
      };
    case "ML_TO_ML":
      return {
        sourceMode: "FRACTIONAL",
        sourceUnit: "ml",
        factorToCanonical: "1",
        canonicalUnit: "ml" as const,
      };
  }
}

const mappingSchema = z.object({
  inventoryItemId: z.string().uuid(),
  locationId: z.string().uuid(),
  loyverseStoreExternalId: z.string().min(1),
  loyverseVariantExternalId: z.string().min(1),
  preset: presetSchema,
});

const createItemSchema = z.object({
  locationId: z.string().uuid(),
  loyverseStoreExternalId: z.string().min(1),
  loyverseVariantExternalId: z.string().min(1),
  preset: presetSchema,
});

async function requireInventoryIntegrationAdmin() {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");

  await Promise.all([
    assertEmployeePermission(
      employee.id,
      "integration.manage",
      employee.homeStoreId,
    ),
    assertEmployeePermission(
      employee.id,
      "inventory.adjust",
      employee.homeStoreId,
    ),
  ]);

  return { user, employee, storeId: employee.homeStoreId };
}

async function validateExternalSource(
  organizationId: string,
  storeExternalId: string,
  variantExternalId: string,
) {
  const db = getDb();

  const [[store], [variant]] = await Promise.all([
    db
      .select({ externalId: loyverseStores.externalId })
      .from(loyverseStores)
      .where(
        and(
          eq(loyverseStores.organizationId, organizationId),
          eq(loyverseStores.externalId, storeExternalId),
        ),
      )
      .limit(1),
    db
      .select({
        externalId: loyverseVariants.externalId,
        loyverseItemExternalId: loyverseVariants.loyverseItemExternalId,
        sku: loyverseVariants.sku,
      })
      .from(loyverseVariants)
      .where(
        and(
          eq(loyverseVariants.organizationId, organizationId),
          eq(loyverseVariants.externalId, variantExternalId),
        ),
      )
      .limit(1),
  ]);

  if (!store || !variant) {
    throw new Error("Tienda o variante Loyverse inválida");
  }

  const [item] = variant.loyverseItemExternalId
    ? await db
        .select({
          itemName: loyverseItems.itemName,
        })
        .from(loyverseItems)
        .where(
          and(
            eq(loyverseItems.organizationId, organizationId),
            eq(loyverseItems.externalId, variant.loyverseItemExternalId),
          ),
        )
        .limit(1)
    : [];

  if (!item) throw new Error("Artículo Loyverse no encontrado");

  return { store, variant, item };
}

async function validateLocation(
  organizationId: string,
  storeId: string,
  locationId: string,
) {
  const [location] = await getDb()
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.id, locationId),
        eq(inventoryLocations.organizationId, organizationId),
        eq(inventoryLocations.storeId, storeId),
        eq(inventoryLocations.isActive, true),
      ),
    )
    .limit(1);

  if (!location) throw new Error("Ubicación inválida");
  return location;
}

export async function saveLoyverseInventoryMapping(formData: FormData) {
  const parsed = mappingSchema.safeParse({
    inventoryItemId: String(formData.get("inventoryItemId") ?? ""),
    locationId: String(formData.get("locationId") ?? ""),
    loyverseStoreExternalId: String(
      formData.get("loyverseStoreExternalId") ?? "",
    ),
    loyverseVariantExternalId: String(
      formData.get("loyverseVariantExternalId") ?? "",
    ),
    preset: String(formData.get("preset") ?? ""),
  });

  if (!parsed.success) throw new Error("Mapeo inválido");

  const { user, employee, storeId } =
    await requireInventoryIntegrationAdmin();
  const db = getDb();
  const config = presetConfig(parsed.data.preset);

  const [[item]] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        canonicalUnit: inventoryItems.canonicalUnit,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, parsed.data.inventoryItemId),
          eq(inventoryItems.organizationId, employee.organizationId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .limit(1),
    validateLocation(
      employee.organizationId,
      storeId,
      parsed.data.locationId,
    ),
    validateExternalSource(
      employee.organizationId,
      parsed.data.loyverseStoreExternalId,
      parsed.data.loyverseVariantExternalId,
    ),
  ]);

  if (!item) throw new Error("Insumo interno no encontrado");
  if (item.canonicalUnit !== config.canonicalUnit) {
    throw new Error(
      `La medición elegida termina en ${config.canonicalUnit}, pero ${item.name} está configurado en ${item.canonicalUnit}`,
    );
  }

  const [variantConflict] = await db
    .select({ id: loyverseInventoryMappings.id })
    .from(loyverseInventoryMappings)
    .where(
      and(
        eq(
          loyverseInventoryMappings.organizationId,
          employee.organizationId,
        ),
        eq(loyverseInventoryMappings.storeId, storeId),
        eq(
          loyverseInventoryMappings.loyverseStoreExternalId,
          parsed.data.loyverseStoreExternalId,
        ),
        eq(
          loyverseInventoryMappings.loyverseVariantExternalId,
          parsed.data.loyverseVariantExternalId,
        ),
      ),
    )
    .limit(1);

  const [currentForBalance] = await db
    .select({ id: loyverseInventoryMappings.id })
    .from(loyverseInventoryMappings)
    .where(
      and(
        eq(loyverseInventoryMappings.storeId, storeId),
        eq(loyverseInventoryMappings.locationId, parsed.data.locationId),
        eq(
          loyverseInventoryMappings.inventoryItemId,
          parsed.data.inventoryItemId,
        ),
      ),
    )
    .limit(1);

  if (
    variantConflict &&
    variantConflict.id !== currentForBalance?.id
  ) {
    throw new Error(
      "Esa variante de Loyverse ya está vinculada a otro insumo",
    );
  }

  const [mapping] = await db
    .insert(loyverseInventoryMappings)
    .values({
      organizationId: employee.organizationId,
      storeId,
      locationId: parsed.data.locationId,
      inventoryItemId: parsed.data.inventoryItemId,
      loyverseStoreExternalId: parsed.data.loyverseStoreExternalId,
      loyverseVariantExternalId: parsed.data.loyverseVariantExternalId,
      sourceMode: config.sourceMode,
      sourceUnit: config.sourceUnit,
      factorToCanonical: config.factorToCanonical,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [
        loyverseInventoryMappings.storeId,
        loyverseInventoryMappings.locationId,
        loyverseInventoryMappings.inventoryItemId,
      ],
      set: {
        loyverseStoreExternalId: parsed.data.loyverseStoreExternalId,
        loyverseVariantExternalId: parsed.data.loyverseVariantExternalId,
        sourceMode: config.sourceMode,
        sourceUnit: config.sourceUnit,
        factorToCanonical: config.factorToCanonical,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning({ id: loyverseInventoryMappings.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "LOYVERSE_INVENTORY_MAPPING_SAVED",
    entityType: "loyverse_inventory_mapping",
    entityId: mapping.id,
    afterData: {
      inventoryItemId: parsed.data.inventoryItemId,
      locationId: parsed.data.locationId,
      loyverseVariantExternalId: parsed.data.loyverseVariantExternalId,
      sourceMode: config.sourceMode,
      sourceUnit: config.sourceUnit,
      factorToCanonical: config.factorToCanonical,
    },
  });

  revalidatePath("/admin/loyverse/inventory");
}

export async function createInventoryItemFromLoyverse(formData: FormData) {
  const parsed = createItemSchema.safeParse({
    locationId: String(formData.get("locationId") ?? ""),
    loyverseStoreExternalId: String(
      formData.get("loyverseStoreExternalId") ?? "",
    ),
    loyverseVariantExternalId: String(
      formData.get("loyverseVariantExternalId") ?? "",
    ),
    preset: String(formData.get("preset") ?? ""),
  });

  if (!parsed.success) throw new Error("Datos inválidos");

  const { user, employee, storeId } =
    await requireInventoryIntegrationAdmin();

  await assertEmployeePermission(
    employee.id,
    "inventory.item.manage",
    storeId,
  );

  const db = getDb();
  const config = presetConfig(parsed.data.preset);

  await validateLocation(
    employee.organizationId,
    storeId,
    parsed.data.locationId,
  );

  const source = await validateExternalSource(
    employee.organizationId,
    parsed.data.loyverseStoreExternalId,
    parsed.data.loyverseVariantExternalId,
  );

  const [alreadyMapped] = await db
    .select({ id: loyverseInventoryMappings.id })
    .from(loyverseInventoryMappings)
    .where(
      and(
        eq(
          loyverseInventoryMappings.organizationId,
          employee.organizationId,
        ),
        eq(
          loyverseInventoryMappings.loyverseVariantExternalId,
          parsed.data.loyverseVariantExternalId,
        ),
      ),
    )
    .limit(1);

  if (alreadyMapped) {
    throw new Error("Ese artículo de Loyverse ya está mapeado");
  }

  const [existingByName] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.organizationId, employee.organizationId),
        eq(inventoryItems.name, source.item.itemName),
      ),
    )
    .limit(1);

  if (existingByName) {
    throw new Error(
      "Ya existe un insumo interno con ese nombre. Usa “Mapear insumo existente”.",
    );
  }

  const [createdItem] = await db
    .insert(inventoryItems)
    .values({
      organizationId: employee.organizationId,
      name: source.item.itemName,
      sku: `LV-${source.variant.sku ?? source.variant.externalId.slice(0, 8)}`,
      category: "IMPORTADO LOYVERSE",
      canonicalUnit: config.canonicalUnit,
      trackingType: "QUANTITY",
      isActive: true,
    })
    .returning({ id: inventoryItems.id });

  const [mapping] = await db
    .insert(loyverseInventoryMappings)
    .values({
      organizationId: employee.organizationId,
      storeId,
      locationId: parsed.data.locationId,
      inventoryItemId: createdItem.id,
      loyverseStoreExternalId: parsed.data.loyverseStoreExternalId,
      loyverseVariantExternalId: parsed.data.loyverseVariantExternalId,
      sourceMode: config.sourceMode,
      sourceUnit: config.sourceUnit,
      factorToCanonical: config.factorToCanonical,
      isActive: true,
    })
    .returning({ id: loyverseInventoryMappings.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_ITEM_CREATED_FROM_LOYVERSE",
    entityType: "inventory_item",
    entityId: createdItem.id,
    afterData: {
      loyverseVariantExternalId: parsed.data.loyverseVariantExternalId,
      mappingId: mapping.id,
      canonicalUnit: config.canonicalUnit,
      sourceUnit: config.sourceUnit,
      factorToCanonical: config.factorToCanonical,
    },
  });

  revalidatePath("/admin/loyverse/inventory");
  revalidatePath("/inventory");
}

export async function removeLoyverseInventoryMapping(formData: FormData) {
  const mappingId = String(formData.get("mappingId") ?? "");
  if (!mappingId) throw new Error("Missing mappingId");

  const { user, employee, storeId } =
    await requireInventoryIntegrationAdmin();
  const db = getDb();

  const [mapping] = await db
    .select()
    .from(loyverseInventoryMappings)
    .where(
      and(
        eq(loyverseInventoryMappings.id, mappingId),
        eq(
          loyverseInventoryMappings.organizationId,
          employee.organizationId,
        ),
        eq(loyverseInventoryMappings.storeId, storeId),
      ),
    )
    .limit(1);

  if (!mapping) throw new Error("Mapeo no encontrado");

  await db
    .delete(loyverseInventoryMappings)
    .where(eq(loyverseInventoryMappings.id, mapping.id));

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "LOYVERSE_INVENTORY_MAPPING_REMOVED",
    entityType: "loyverse_inventory_mapping",
    entityId: mapping.id,
    beforeData: {
      inventoryItemId: mapping.inventoryItemId,
      loyverseVariantExternalId: mapping.loyverseVariantExternalId,
    },
  });

  revalidatePath("/admin/loyverse/inventory");
}

export async function importLoyverseStockAsTheoretical() {
  const { user, employee, storeId } =
    await requireInventoryIntegrationAdmin();

  try {
    await syncLoyverseInventory();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al consultar Loyverse";
    redirect(
      `/admin/loyverse/inventory?error=${encodeURIComponent(message)}`,
    );
  }

  const db = getDb();

  const [mappings, levels, balances] = await Promise.all([
    db
      .select()
      .from(loyverseInventoryMappings)
      .where(
        and(
          eq(
            loyverseInventoryMappings.organizationId,
            employee.organizationId,
          ),
          eq(loyverseInventoryMappings.storeId, storeId),
          eq(loyverseInventoryMappings.isActive, true),
        ),
      ),
    db
      .select()
      .from(loyverseInventoryLevels)
      .where(
        eq(
          loyverseInventoryLevels.organizationId,
          employee.organizationId,
        ),
      ),
    db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.storeId, storeId)),
  ]);

  const levelByKey = new Map(
    levels.map((level) => [
      `${level.storeExternalId}::${level.variantExternalId}`,
      level,
    ]),
  );

  const balanceByKey = new Map(
    balances.map((balance) => [
      `${balance.locationId}::${balance.inventoryItemId}`,
      balance,
    ]),
  );

  const batchId = randomUUID();
  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  for (const mapping of mappings) {
    const level = levelByKey.get(
      `${mapping.loyverseStoreExternalId}::${mapping.loyverseVariantExternalId}`,
    );

    if (!level) {
      missing += 1;
      continue;
    }

    const target =
      Number(level.inStock) * Number(mapping.factorToCanonical);
    const balanceKey = `${mapping.locationId}::${mapping.inventoryItemId}`;
    const balance = balanceByKey.get(balanceKey);
    const current = Number(balance?.theoreticalQuantity ?? 0);
    const delta = target - current;

    if (Math.abs(delta) < 0.0005) {
      unchanged += 1;
      continue;
    }

    await postInventoryMovement({
      organizationId: employee.organizationId,
      storeId,
      locationId: mapping.locationId,
      inventoryItemId: mapping.inventoryItemId,
      movementType: balance ? "MANUAL_ADJUSTMENT" : "OPENING_BALANCE",
      quantityDelta: delta.toFixed(3),
      sourceType: "LOYVERSE_STOCK_IMPORT",
      sourceId: batchId,
      occurredAt: new Date(),
      employeeId: employee.id,
      note: `Existencia Loyverse ${level.inStock} ${mapping.sourceUnit} × ${mapping.factorToCanonical}`,
      externalProvider: "LOYVERSE",
      externalId: `stock-import:${batchId}:${mapping.id}`,
    });

    updated += 1;
  }

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "LOYVERSE_STOCK_IMPORTED_AS_THEORETICAL",
    entityType: "inventory_import",
    entityId: batchId,
    afterData: {
      mappings: mappings.length,
      updated,
      unchanged,
      missing,
    },
  });

  revalidatePath("/admin/loyverse/inventory");
  revalidatePath("/inventory");
  redirect(
    `/admin/loyverse/inventory?imported=${updated}&unchanged=${unchanged}&missing=${missing}`,
  );
}
