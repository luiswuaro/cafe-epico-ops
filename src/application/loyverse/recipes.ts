import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryItems,
  loyverseInventoryMappings,
  loyverseItems,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

type RawComponent = {
  variantExternalId: string;
  quantity: number;
};

function readComponents(payload: Record<string, unknown>): RawComponent[] {
  const raw = payload.components;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((component) => {
    if (!component || typeof component !== "object") return [];
    const row = component as Record<string, unknown>;
    const variantExternalId =
      typeof row.variant_id === "string" ? row.variant_id : "";
    const quantity =
      typeof row.quantity === "number" ? row.quantity : Number(row.quantity);

    if (!variantExternalId || !Number.isFinite(quantity)) return [];
    return [{ variantExternalId, quantity }];
  });
}

export async function getLoyverseRecipeSource(
  organizationId: string,
  storeId: string,
) {
  const db = getDb();

  const [items, variants, mappings] = await Promise.all([
    db
      .select({
        externalId: loyverseItems.externalId,
        itemName: loyverseItems.itemName,
        payload: loyverseItems.payload,
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
        variantName: loyverseVariants.variantName,
      })
      .from(loyverseVariants)
      .where(eq(loyverseVariants.organizationId, organizationId)),
    db
      .select({
        variantExternalId:
          loyverseInventoryMappings.loyverseVariantExternalId,
        sourceUnit: loyverseInventoryMappings.sourceUnit,
        factorToCanonical: loyverseInventoryMappings.factorToCanonical,
        inventoryItemName: inventoryItems.name,
        canonicalUnit: inventoryItems.canonicalUnit,
      })
      .from(loyverseInventoryMappings)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, loyverseInventoryMappings.inventoryItemId),
      )
      .where(
        and(
          eq(
            loyverseInventoryMappings.organizationId,
            organizationId,
          ),
          eq(loyverseInventoryMappings.storeId, storeId),
          eq(loyverseInventoryMappings.isActive, true),
        ),
      ),
  ]);

  const itemNameById = new Map(
    items.map((item) => [item.externalId, item.itemName]),
  );
  const variantById = new Map(
    variants.map((variant) => [variant.externalId, variant]),
  );
  const mappingByVariant = new Map(
    mappings.map((mapping) => [mapping.variantExternalId, mapping]),
  );

  const recipes = items
    .filter((item) => item.payload.is_composite === true)
    .map((item) => {
      const components = readComponents(item.payload).map((component) => {
        const variant = variantById.get(component.variantExternalId);
        const mapping = mappingByVariant.get(component.variantExternalId);
        const sourceItemName = variant?.loyverseItemExternalId
          ? itemNameById.get(variant.loyverseItemExternalId)
          : null;

        return {
          variantExternalId: component.variantExternalId,
          quantity: component.quantity,
          sourceName:
            variant?.variantName ||
            sourceItemName ||
            component.variantExternalId,
          mapped: Boolean(mapping),
          inventoryItemName: mapping?.inventoryItemName ?? null,
          sourceUnit: mapping?.sourceUnit ?? null,
          canonicalUnit: mapping?.canonicalUnit ?? null,
          canonicalQuantity: mapping
            ? component.quantity * Number(mapping.factorToCanonical)
            : null,
        };
      });

      return {
        externalId: item.externalId,
        itemName: item.itemName,
        components,
        mappedComponents: components.filter((component) => component.mapped)
          .length,
      };
    })
    .sort((a, b) => a.itemName.localeCompare(b.itemName, "es"));

  return {
    recipes,
    totalComponents: recipes.reduce(
      (sum, recipe) => sum + recipe.components.length,
      0,
    ),
    mappedComponents: recipes.reduce(
      (sum, recipe) => sum + recipe.mappedComponents,
      0,
    ),
  };
}
