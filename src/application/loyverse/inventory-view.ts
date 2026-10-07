import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCategories,
  loyverseInventoryLevels,
  loyverseItems,
  loyverseStores,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

function bool(value: unknown) {
  return value === true || value === "true";
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getLoyverseInventoryView(
  organizationId: string,
  preferredStoreExternalId?: string,
) {
  const db = getDb();

  const [stores, items, variants, levels, categories] = await Promise.all([
    db
      .select({
        externalId: loyverseStores.externalId,
        name: loyverseStores.name,
      })
      .from(loyverseStores)
      .where(eq(loyverseStores.organizationId, organizationId)),
    db
      .select({
        externalId: loyverseItems.externalId,
        itemName: loyverseItems.itemName,
        payload: loyverseItems.payload,
        syncedAt: loyverseItems.syncedAt,
      })
      .from(loyverseItems)
      .where(
        and(
          eq(loyverseItems.organizationId, organizationId),
          isNull(loyverseItems.deletedAt),
        ),
      ),
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
      .select({
        variantExternalId: loyverseInventoryLevels.variantExternalId,
        storeExternalId: loyverseInventoryLevels.storeExternalId,
        inStock: loyverseInventoryLevels.inStock,
        syncedAt: loyverseInventoryLevels.syncedAt,
      })
      .from(loyverseInventoryLevels)
      .where(eq(loyverseInventoryLevels.organizationId, organizationId)),
    db
      .select({
        externalId: loyverseCategories.externalId,
        name: loyverseCategories.name,
      })
      .from(loyverseCategories)
      .where(eq(loyverseCategories.organizationId, organizationId)),
  ]);

  const selectedStore =
    stores.find((store) => store.externalId === preferredStoreExternalId) ??
    stores[0] ??
    null;

  if (!selectedStore) {
    return {
      stores,
      selectedStore: null,
      rows: [],
      lastSyncedAt: null as Date | null,
    };
  }

  const itemById = new Map(items.map((item) => [item.externalId, item]));
  const variantById = new Map(
    variants.map((variant) => [variant.externalId, variant]),
  );
  const categoryById = new Map(
    categories.map((category) => [category.externalId, category.name]),
  );

  const rows = levels
    .filter((level) => level.storeExternalId === selectedStore.externalId)
    .flatMap((level) => {
      const variant = variantById.get(level.variantExternalId);
      if (!variant?.loyverseItemExternalId) return [];

      const item = itemById.get(variant.loyverseItemExternalId);
      if (!item) return [];

      const payload = item.payload;
      if (!bool(payload.track_stock)) return [];

      const categoryId =
        typeof payload.category_id === "string" ? payload.category_id : "";
      const variantPayload = asRecord(variant.payload);
      const storeRows = Array.isArray(variantPayload.stores)
        ? variantPayload.stores
        : [];
      const storeConfig = storeRows
        .map(asRecord)
        .find(
          (store) => store.store_id === selectedStore.externalId,
        );

      const soldByWeight = bool(payload.sold_by_weight);
      const purchaseCost =
        numberOrNull(variantPayload.purchase_cost) ??
        numberOrNull(variantPayload.cost);
      const lowStock = numberOrNull(storeConfig?.low_stock);
      const optimalStock = numberOrNull(storeConfig?.optimal_stock);
      const inStock = Number(level.inStock);

      return [{
        variantExternalId: variant.externalId,
        itemExternalId: item.externalId,
        itemName: item.itemName,
        sku: variant.sku,
        category:
          categoryById.get(categoryId) ??
          (categoryId ? "Categoría pendiente de sincronizar" : "Sin categoría"),
        categoryId: categoryId || null,
        inStock,
        soldByWeight,
        unitLabel: soldByWeight ? "peso/volumen" : "pz",
        purchaseCost,
        lowStock,
        optimalStock,
        low:
          lowStock != null &&
          Number.isFinite(inStock) &&
          inStock <= lowStock,
        syncedAt: level.syncedAt,
      }];
    })
    .sort((a, b) => {
      const category = a.category.localeCompare(b.category, "es");
      return category || a.itemName.localeCompare(b.itemName, "es");
    });

  const lastSyncedAt =
    rows.reduce<Date | null>((latest, row) => {
      if (!latest || row.syncedAt > latest) return row.syncedAt;
      return latest;
    }, null);

  return {
    stores,
    selectedStore,
    rows,
    lastSyncedAt,
  };
}
