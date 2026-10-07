import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getOperationalRecipeSource } from "@/src/application/loyverse/recipe-book";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCategories,
  loyverseItems,
  loyverseReceiptLines,
  loyverseReceipts,
  loyverseVariants,
  posCatalogOverrides,
  posManualProducts,
} from "@/src/infrastructure/db/schema";

export type PosServiceMode = "DINE_IN" | "TAKEAWAY";
export type PosCatalogCategory = "CALIENTES" | "FRÍAS" | "ALIMENTOS";

export type PosRecipeComponent = {
  variantExternalId: string | null;
  itemExternalId: string | null;
  name: string;
  quantity: number;
  unitLabel: string;
  category: string | null;
};

type StoredRecipe = {
  components: PosRecipeComponent[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBool(value: unknown) {
  return value === true || value === "true";
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentSalePrice(payload: Record<string, unknown>) {
  const stores = Array.isArray(payload.stores) ? payload.stores : [];
  for (const value of stores) {
    const row = asObject(value);
    const price = nullableNumber(row.price);
    if (price != null) return price;
  }
  return nullableNumber(payload.default_price);
}

function availableForSale(payload: Record<string, unknown>) {
  const stores = Array.isArray(payload.stores) ? payload.stores : [];
  return stores.some((value) => asObject(value).available_for_sale === true);
}

function storedRecipe(value: unknown): StoredRecipe | null {
  const row = asObject(value);
  if (!Array.isArray(row.components)) return null;

  const components = row.components.flatMap((value) => {
    const component = asObject(value);
    const name =
      typeof component.name === "string" ? component.name.trim() : "";
    const quantity = Number(component.quantity);
    const unitLabel =
      typeof component.unitLabel === "string"
        ? component.unitLabel.trim()
        : "u.";
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return [];

    return [{
      variantExternalId:
        typeof component.variantExternalId === "string"
          ? component.variantExternalId
          : null,
      itemExternalId:
        typeof component.itemExternalId === "string"
          ? component.itemExternalId
          : null,
      name,
      quantity,
      unitLabel,
      category:
        typeof component.category === "string" ? component.category : null,
    }];
  });

  return { components };
}

function mapEffectiveComponents(
  components: Array<{
    variantExternalId: string;
    itemExternalId: string | null;
    sourceName: string;
    quantity: number;
    unitLabel: string;
    category: string;
  }>,
): PosRecipeComponent[] {
  return components.map((component) => ({
    variantExternalId: component.variantExternalId,
    itemExternalId: component.itemExternalId,
    name: component.sourceName,
    quantity: component.quantity,
    unitLabel: component.unitLabel,
    category: component.category,
  }));
}

export async function getPosCatalog(
  organizationId: string,
  options: { includeDisabled?: boolean } = {},
) {
  const db = getDb();
  const source = await getOperationalRecipeSource(organizationId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const itemNameExpr = sql<string>`${loyverseReceiptLines.payload}->>'item_name'`;

  const [items, variants, categories, overrides, manual, popularityRows] =
    await Promise.all([
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
          itemExternalId: loyverseVariants.loyverseItemExternalId,
          payload: loyverseVariants.payload,
        })
        .from(loyverseVariants)
        .where(eq(loyverseVariants.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseCategories.externalId,
          name: loyverseCategories.name,
        })
        .from(loyverseCategories)
        .where(eq(loyverseCategories.organizationId, organizationId)),
      db
        .select()
        .from(posCatalogOverrides)
        .where(eq(posCatalogOverrides.organizationId, organizationId)),
      db
        .select()
        .from(posManualProducts)
        .where(eq(posManualProducts.organizationId, organizationId)),
      db
        .select({
          itemName: itemNameExpr,
          units: sql<string>`sum(${loyverseReceiptLines.quantity})::text`,
        })
        .from(loyverseReceiptLines)
        .innerJoin(
          loyverseReceipts,
          and(
            eq(
              loyverseReceipts.organizationId,
              loyverseReceiptLines.organizationId,
            ),
            eq(
              loyverseReceipts.externalId,
              loyverseReceiptLines.receiptExternalId,
            ),
          ),
        )
        .where(
          and(
            eq(loyverseReceipts.organizationId, organizationId),
            eq(loyverseReceipts.receiptType, "SALE"),
            gte(loyverseReceipts.receiptDate, since),
            sql`coalesce(${loyverseReceipts.payload}->>'cancelled_at','') = ''`,
          ),
        )
        .groupBy(itemNameExpr),
    ]);

  const categoryById = new Map(
    categories.map((category) => [category.externalId, category.name]),
  );
  const variantByItem = new Map(
    variants
      .filter((variant) => variant.itemExternalId)
      .map((variant) => [variant.itemExternalId!, variant]),
  );
  const overrideBySource = new Map(
    overrides.map((override) => [override.sourceExternalId, override]),
  );
  const popularity = new Map(
    popularityRows.map((row) => [
      normalize(row.itemName ?? ""),
      Number(row.units ?? 0),
    ]),
  );

  const loyverseCatalog = source.recipes
    .filter((recipe) => recipe.salePrice != null && recipe.salePrice > 0)
    .map((recipe) => {
      const override = overrideBySource.get(recipe.externalId);
      const baseDineIn = mapEffectiveComponents(
        recipe.serviceRecipes.DINE_IN.effectiveComponents,
      );
      const baseTakeaway = mapEffectiveComponents(
        recipe.serviceRecipes.TAKEAWAY.effectiveComponents,
      );
      const overrideDineIn = storedRecipe(override?.recipeDineIn);
      const overrideTakeaway = storedRecipe(override?.recipeTakeaway);

      return {
        id: recipe.externalId,
        sourceType: "LOYVERSE" as const,
        variantExternalId: recipe.variantExternalId,
        name: override?.displayName?.trim() || recipe.itemName,
        category: recipe.category as PosCatalogCategory,
        price:
          override?.displayPrice != null
            ? Number(override.displayPrice)
            : Number(recipe.salePrice),
        active: override?.isEnabled ?? true,
        popularity30d: popularity.get(normalize(recipe.itemName)) ?? 0,
        serviceRecipes: {
          DINE_IN: {
            externalId: recipe.serviceRecipes.DINE_IN.externalId,
            sourceCategory: recipe.serviceRecipes.DINE_IN.sourceCategory,
            components: overrideDineIn?.components ?? baseDineIn,
            configured:
              (overrideDineIn?.components.length ?? baseDineIn.length) > 0,
          },
          TAKEAWAY: {
            externalId: recipe.serviceRecipes.TAKEAWAY.externalId,
            sourceCategory: recipe.serviceRecipes.TAKEAWAY.sourceCategory,
            components: overrideTakeaway?.components ?? baseTakeaway,
            configured:
              (overrideTakeaway?.components.length ?? baseTakeaway.length) > 0,
          },
        },
      };
    });

  const compositeIds = new Set(loyverseCatalog.map((item) => item.id));
  const simpleFoods = items.flatMap((item) => {
    const categoryId =
      typeof item.payload.category_id === "string"
        ? item.payload.category_id
        : "";
    const categoryName = categoryById.get(categoryId) ?? "";
    if (
      normalize(categoryName) !== "ALIMENTOS" ||
      asBool(item.payload.is_composite) ||
      compositeIds.has(item.externalId)
    ) {
      return [];
    }

    const variant = variantByItem.get(item.externalId);
    if (!variant || !availableForSale(variant.payload)) return [];
    const price = currentSalePrice(variant.payload);
    if (price == null || price <= 0) return [];

    const override = overrideBySource.get(item.externalId);
    const dineIn = storedRecipe(override?.recipeDineIn);
    const takeaway = storedRecipe(override?.recipeTakeaway);

    return [{
      id: item.externalId,
      sourceType: "LOYVERSE" as const,
      variantExternalId: variant.externalId,
      name: override?.displayName?.trim() || item.itemName,
      category: "ALIMENTOS" as const,
      price:
        override?.displayPrice != null
          ? Number(override.displayPrice)
          : price,
      active: override?.isEnabled ?? true,
      popularity30d: popularity.get(normalize(item.itemName)) ?? 0,
      serviceRecipes: {
        DINE_IN: {
          externalId: item.externalId,
          sourceCategory: "ALIMENTOS",
          components: dineIn?.components ?? [],
          configured: (dineIn?.components.length ?? 0) > 0,
        },
        TAKEAWAY: {
          externalId: item.externalId,
          sourceCategory: "ALIMENTOS",
          components: takeaway?.components ?? dineIn?.components ?? [],
          configured:
            (takeaway?.components.length ?? dineIn?.components.length ?? 0) > 0,
        },
      },
    }];
  });

  const manualCatalog = manual.map((item) => {
    const dineIn = storedRecipe(item.recipeDineIn) ?? { components: [] };
    const takeaway = storedRecipe(item.recipeTakeaway) ?? dineIn;

    return {
      id: "manual:" + item.id,
      sourceType: "MANUAL" as const,
      variantExternalId: null,
      name: item.name,
      category: item.category as PosCatalogCategory,
      price: Number(item.price),
      active: item.isActive,
      popularity30d: 0,
      serviceRecipes: {
        DINE_IN: {
          externalId: "manual:" + item.id,
          sourceCategory: item.category,
          components: dineIn.components,
          configured: dineIn.components.length > 0,
        },
        TAKEAWAY: {
          externalId: "manual:" + item.id,
          sourceCategory: item.category,
          components: takeaway.components,
          configured: takeaway.components.length > 0,
        },
      },
    };
  });

  return [...loyverseCatalog, ...simpleFoods, ...manualCatalog]
    .filter((item) => options.includeDisabled || item.active)
    .sort(
      (a, b) =>
        b.popularity30d - a.popularity30d ||
        a.name.localeCompare(b.name, "es"),
    );
}
