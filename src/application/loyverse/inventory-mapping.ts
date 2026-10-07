import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances,
  inventoryItems,
  inventoryLocations,
  loyverseInventoryLevels,
  loyverseInventoryMappings,
  loyverseItems,
  loyverseStores,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeInventoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "DE")
    .join(" ");
}

export function mappingPreset(input: {
  sourceMode: string;
  sourceUnit: string;
  factorToCanonical: string | number;
}) {
  const factor = Number(input.factorToCanonical);
  if (input.sourceMode === "UNIT" && input.sourceUnit === "pz" && factor === 1) {
    return "PIECE";
  }
  if (input.sourceMode === "FRACTIONAL" && input.sourceUnit === "kg" && factor === 1000) {
    return "KG_TO_G";
  }
  if (input.sourceMode === "FRACTIONAL" && input.sourceUnit === "g" && factor === 1) {
    return "G_TO_G";
  }
  if (input.sourceMode === "FRACTIONAL" && input.sourceUnit === "L" && factor === 1000) {
    return "L_TO_ML";
  }
  if (input.sourceMode === "FRACTIONAL" && input.sourceUnit === "ml" && factor === 1) {
    return "ML_TO_ML";
  }
  return "CUSTOM";
}

export async function getLoyverseInventoryMappingAdmin(
  organizationId: string,
  storeId: string,
) {
  const db = getDb();

  const [
    locations,
    internalItems,
    externalStores,
    externalItems,
    externalVariants,
    mappings,
    balances,
    inventoryLevels,
  ] = await Promise.all([
    db
      .select({
        id: inventoryLocations.id,
        name: inventoryLocations.name,
      })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.organizationId, organizationId),
          eq(inventoryLocations.storeId, storeId),
          eq(inventoryLocations.isActive, true),
        ),
      )
      .orderBy(asc(inventoryLocations.name)),
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        category: inventoryItems.category,
        canonicalUnit: inventoryItems.canonicalUnit,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, organizationId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .orderBy(asc(inventoryItems.category), asc(inventoryItems.name)),
    db
      .select({
        externalId: loyverseStores.externalId,
        name: loyverseStores.name,
      })
      .from(loyverseStores)
      .where(eq(loyverseStores.organizationId, organizationId))
      .orderBy(asc(loyverseStores.name)),
    db
      .select({
        externalId: loyverseItems.externalId,
        itemName: loyverseItems.itemName,
        payload: loyverseItems.payload,
      })
      .from(loyverseItems)
      .where(eq(loyverseItems.organizationId, organizationId)),
    db
      .select({
        externalId: loyverseVariants.externalId,
        loyverseItemExternalId: loyverseVariants.loyverseItemExternalId,
        sku: loyverseVariants.sku,
        payload: loyverseVariants.payload,
      })
      .from(loyverseVariants)
      .where(eq(loyverseVariants.organizationId, organizationId)),
    db
      .select()
      .from(loyverseInventoryMappings)
      .where(
        and(
          eq(loyverseInventoryMappings.organizationId, organizationId),
          eq(loyverseInventoryMappings.storeId, storeId),
          eq(loyverseInventoryMappings.isActive, true),
        ),
      ),
    db
      .select({
        locationId: inventoryBalances.locationId,
        inventoryItemId: inventoryBalances.inventoryItemId,
        theoreticalQuantity: inventoryBalances.theoreticalQuantity,
      })
      .from(inventoryBalances)
      .where(eq(inventoryBalances.storeId, storeId)),
    db
      .select({
        variantExternalId: loyverseInventoryLevels.variantExternalId,
        storeExternalId: loyverseInventoryLevels.storeExternalId,
        inStock: loyverseInventoryLevels.inStock,
        syncedAt: loyverseInventoryLevels.syncedAt,
      })
      .from(loyverseInventoryLevels)
      .where(eq(loyverseInventoryLevels.organizationId, organizationId)),
  ]);

  const componentVariantIds = new Set<string>();
  for (const item of externalItems) {
    const payload = asRecord(item.payload);
    for (const component of asArray(payload.components)) {
      const record = asRecord(component);
      const variantId =
        typeof record.variant_id === "string" ? record.variant_id : null;
      if (variantId) componentVariantIds.add(variantId);
    }
  }

  const itemByExternalId = new Map(
    externalItems.map((item) => [item.externalId, item]),
  );

  const candidates = externalVariants
    .map((variant) => {
      const parent = variant.loyverseItemExternalId
        ? itemByExternalId.get(variant.loyverseItemExternalId)
        : undefined;
      if (!parent) return null;

      const itemPayload = asRecord(parent.payload);
      const soldByWeight = itemPayload.sold_by_weight === true;
      const trackStock = itemPayload.track_stock === true;
      const usedAsComponent = componentVariantIds.has(variant.externalId);

      if (!trackStock && !usedAsComponent) return null;

      return {
        variantExternalId: variant.externalId,
        itemExternalId: parent.externalId,
        itemName: parent.itemName,
        sku: variant.sku,
        soldByWeight,
        trackStock,
        usedAsComponent,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, "es"));

  const levelByKey = new Map(
    inventoryLevels.map((row) => [
      `${row.storeExternalId}::${row.variantExternalId}`,
      row,
    ]),
  );
  const balanceByKey = new Map(
    balances.map((row) => [
      `${row.locationId}::${row.inventoryItemId}`,
      row,
    ]),
  );
  const internalById = new Map(internalItems.map((item) => [item.id, item]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const candidateByVariant = new Map(
    candidates.map((candidate) => [candidate.variantExternalId, candidate]),
  );

  const preview = mappings.map((mapping) => {
    const internal = internalById.get(mapping.inventoryItemId);
    const location = locationById.get(mapping.locationId);
    const candidate = candidateByVariant.get(mapping.loyverseVariantExternalId);
    const level = levelByKey.get(
      `${mapping.loyverseStoreExternalId}::${mapping.loyverseVariantExternalId}`,
    );
    const balance = balanceByKey.get(
      `${mapping.locationId}::${mapping.inventoryItemId}`,
    );

    const loyverseQuantity = level ? Number(level.inStock) : null;
    const factor = Number(mapping.factorToCanonical);
    const convertedQuantity =
      loyverseQuantity == null ? null : loyverseQuantity * factor;
    const theoreticalQuantity = Number(balance?.theoreticalQuantity ?? 0);

    return {
      ...mapping,
      itemName: internal?.name ?? "Insumo eliminado",
      canonicalUnit: internal?.canonicalUnit ?? "pz",
      locationName: location?.name ?? "Ubicación eliminada",
      loyverseItemName: candidate?.itemName ?? "Variante no encontrada",
      loyverseSku: candidate?.sku ?? null,
      loyverseSoldByWeight: candidate?.soldByWeight ?? false,
      loyverseQuantity,
      convertedQuantity,
      theoreticalQuantity,
      delta:
        convertedQuantity == null
          ? null
          : convertedQuantity - theoreticalQuantity,
      levelSyncedAt: level?.syncedAt ?? null,
      preset: mappingPreset(mapping),
    };
  });

  const mappingByInternal = new Map(
    mappings.map((mapping) => [mapping.inventoryItemId, mapping]),
  );

  const exactNameSuggestions = internalItems
    .filter((item) => !mappingByInternal.has(item.id))
    .map((item) => {
      const normalized = normalizeInventoryName(item.name);
      const matches = candidates.filter(
        (candidate) =>
          normalizeInventoryName(candidate.itemName) === normalized,
      );
      if (matches.length !== 1) return null;

      return {
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        canonicalUnit: item.canonicalUnit,
        candidate: matches[0],
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    locations,
    internalItems,
    externalStores,
    candidates,
    preview,
    exactNameSuggestions,
    mappedInternalIds: new Set(mappings.map((mapping) => mapping.inventoryItemId)),
    mappedVariantIds: new Set(
      mappings.map((mapping) => mapping.loyverseVariantExternalId),
    ),
  };
}
