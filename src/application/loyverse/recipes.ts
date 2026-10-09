import { eq, isNull, and } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCategories,
  loyverseItemSettings,
  loyverseItems,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

type ComponentRef = {
  variantExternalId: string;
  quantity: number;
};

type ItemRecord = {
  externalId: string;
  itemName: string;
  payload: Record<string, unknown>;
};

type VariantRecord = {
  externalId: string;
  loyverseItemExternalId: string | null;
  variantName: string | null;
  sku: string | null;
  payload: Record<string, unknown>;
};

function readComponents(payload: Record<string, unknown>): ComponentRef[] {
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

function asBool(value: unknown) {
  return value === true || value === "true";
}

function itemCategoryId(item: ItemRecord) {
  return typeof item.payload.category_id === "string"
    ? item.payload.category_id
    : "";
}

function displayUnit(item: ItemRecord) {
  if (asBool(item.payload.is_composite)) return "receta";
  return asBool(item.payload.sold_by_weight) ? "peso/volumen" : "pz";
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentSalePrice(payload: Record<string, unknown>) {
  const stores = Array.isArray(payload.stores) ? payload.stores : [];
  for (const value of stores) {
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const price = nullableNumber(row.price);
    if (price != null) return price;
  }
  return nullableNumber(payload.default_price);
}

function availableForSale(variant: VariantRecord) {
  const stores = Array.isArray(variant.payload.stores)
    ? variant.payload.stores
    : [];

  return stores.some((row) => {
    if (!row || typeof row !== "object") return false;
    return (row as Record<string, unknown>).available_for_sale === true;
  });
}

export async function getLoyverseRecipeSource(organizationId: string) {
  const db = getDb();

  const [items, variants, categories, settings] = await Promise.all([
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
        sku: loyverseVariants.sku,
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
      .select({
        variantExternalId: loyverseItemSettings.variantExternalId,
        displayUnit: loyverseItemSettings.displayUnit,
        displayFactor: loyverseItemSettings.displayFactor,
        unitCostOverride: loyverseItemSettings.unitCostOverride,
        packagePrice: loyverseItemSettings.packagePrice,
        packageQuantityNative: loyverseItemSettings.packageQuantityNative,
      })
      .from(loyverseItemSettings)
      .where(eq(loyverseItemSettings.organizationId, organizationId)),
  ]);

  const itemById = new Map(
    items.map((item) => [item.externalId, item as ItemRecord]),
  );
  const variantById = new Map(
    variants.map((variant) => [
      variant.externalId,
      variant as VariantRecord,
    ]),
  );
  const categoryById = new Map(
    categories.map((category) => [category.externalId, category.name]),
  );
  const settingByVariant = new Map(
    settings.map((setting) => [setting.variantExternalId, setting]),
  );
  const configuredUnitCost = (variant: VariantRecord) => {
    const setting = settingByVariant.get(variant.externalId);
    const override = nullableNumber(setting?.unitCostOverride);
    if (override != null) return override;

    const packagePrice = nullableNumber(setting?.packagePrice);
    const packageQuantity = nullableNumber(
      setting?.packageQuantityNative,
    );
    if (
      packagePrice != null &&
      packageQuantity != null &&
      packageQuantity > 0
    ) {
      return packagePrice / packageQuantity;
    }

    return nullableNumber(variant.payload.cost);
  };

  const disposablePattern =
    /(VASO|TAPA|POPOTE|MANGA|FAJILLA|SERVILLETA|BOLSA|CUBIERTO|CHAROLA)/i;
  const presentation = (
    item: ItemRecord,
    variant: VariantRecord,
    quantity: number,
  ) => {
    if (asBool(item.payload.is_composite)) {
      return {
        displayQuantity: quantity,
        displayUnit: "receta",
      };
    }

    const setting = settingByVariant.get(variant.externalId);
    const soldByWeight = asBool(item.payload.sold_by_weight);
    const factor =
      setting?.displayUnit && setting.displayFactor != null
        ? Number(setting.displayFactor)
        : 1;

    return {
      displayQuantity: quantity * (Number.isFinite(factor) ? factor : 1),
      displayUnit:
        setting?.displayUnit ??
        (soldByWeight ? "unidad Loyverse" : "pz"),
    };
  };

  const variantForItem = new Map<string, VariantRecord>();
  for (const variant of variants as VariantRecord[]) {
    if (
      variant.loyverseItemExternalId &&
      !variantForItem.has(variant.loyverseItemExternalId)
    ) {
      variantForItem.set(variant.loyverseItemExternalId, variant);
    }
  }

  function componentDetail(ref: ComponentRef) {
    const variant = variantById.get(ref.variantExternalId);
    const item = variant?.loyverseItemExternalId
      ? itemById.get(variant.loyverseItemExternalId)
      : undefined;

    if (!variant || !item) {
      return {
        variantExternalId: ref.variantExternalId,
        itemExternalId: null,
        sourceName: ref.variantExternalId,
        quantity: ref.quantity,
        displayQuantity: ref.quantity,
        displayUnit: "u.",
        unitLabel: "unidad desconocida",
        category: "Sin resolver",
        isComposite: false,
        isDisposable: false,
        sku: null,
        unitCost: null,
        inventoryTracked: false,
        inventoryResolved: false,
      };
    }

    const categoryId = itemCategoryId(item);
    const sourceName = variant.variantName || item.itemName;
    const display = presentation(item, variant, ref.quantity);
    const setting = settingByVariant.get(variant.externalId);
    return {
      variantExternalId: ref.variantExternalId,
      itemExternalId: item.externalId,
      sourceName,
      quantity: ref.quantity,
      displayQuantity: display.displayQuantity,
      displayUnit: display.displayUnit,
      unitLabel: displayUnit(item),
      category:
        categoryById.get(categoryId) ??
        (categoryId ? "Categoría pendiente de sincronizar" : "Sin categoría"),
      isComposite: asBool(item.payload.is_composite),
      isDisposable: disposablePattern.test(sourceName),
      sku: variant.sku,
      unitCost: configuredUnitCost(variant),
      inventoryTracked: asBool(item.payload.track_stock),
      inventoryResolved: true,
    };
  }

  function expandVariant(
    variantExternalId: string,
    factor: number,
    path: Set<string>,
    output: Map<
      string,
      {
        variantExternalId: string;
        itemExternalId: string | null;
        sourceName: string;
        quantity: number;
        unitLabel: string;
        category: string;
        sku: string | null;
        unitCost: number | null;
        inventoryTracked: boolean;
        inventoryResolved: boolean;
      }
    >,
  ) {
    if (path.has(variantExternalId)) return;

    const variant = variantById.get(variantExternalId);
    const item = variant?.loyverseItemExternalId
      ? itemById.get(variant.loyverseItemExternalId)
      : undefined;

    if (!variant || !item) {
      const current = output.get(variantExternalId);
      output.set(variantExternalId, {
        variantExternalId,
        itemExternalId: null,
        sourceName: variantExternalId,
        quantity: (current?.quantity ?? 0) + factor,
        unitLabel: "unidad desconocida",
        category: "Sin resolver",
        sku: null,
        unitCost: null,
        inventoryTracked: false,
        inventoryResolved: false,
      });
      return;
    }

    const nested = readComponents(item.payload);
    if (!asBool(item.payload.is_composite) || nested.length === 0) {
      const categoryId = itemCategoryId(item);
      const current = output.get(variantExternalId);
      output.set(variantExternalId, {
        variantExternalId,
        itemExternalId: item.externalId,
        sourceName: variant.variantName || item.itemName,
        quantity: (current?.quantity ?? 0) + factor,
        unitLabel: displayUnit(item),
        category:
          categoryById.get(categoryId) ??
          (categoryId
            ? "Categoría pendiente de sincronizar"
            : "Sin categoría"),
        sku: variant.sku,
        unitCost: configuredUnitCost(variant),
        inventoryTracked: asBool(item.payload.track_stock),
        inventoryResolved: true,
      });
      return;
    }

    const nextPath = new Set(path);
    nextPath.add(variantExternalId);

    for (const component of nested) {
      expandVariant(
        component.variantExternalId,
        factor * component.quantity,
        nextPath,
        output,
      );
    }
  }

  const recipes = items
    .filter((item) => asBool(item.payload.is_composite))
    .flatMap((item) => {
      const variant = variantForItem.get(item.externalId);
      if (!variant) return [];

      const directRefs = readComponents(item.payload);
      const directComponents = directRefs.map(componentDetail);
      const effective = new Map<
        string,
        {
          variantExternalId: string;
          itemExternalId: string | null;
          sourceName: string;
          quantity: number;
          unitLabel: string;
          category: string;
          sku: string | null;
          unitCost: number | null;
        }
      >();

      for (const component of directRefs) {
        expandVariant(
          component.variantExternalId,
          component.quantity,
          new Set([variant.externalId]),
          effective,
        );
      }

      const categoryId = itemCategoryId(item);
      return [{
        externalId: item.externalId,
        variantExternalId: variant.externalId,
        itemName: item.itemName,
        sku: variant.sku,
        category:
          categoryById.get(categoryId) ??
          (categoryId
            ? "Categoría pendiente de sincronizar"
            : "Sin categoría"),
        availableForSale: availableForSale(variant),
        salePrice: currentSalePrice(variant.payload),
        loyverseCost: nullableNumber(variant.payload.cost),
        directComponents,
        effectiveComponents: [...effective.values()].sort((a, b) =>
          a.sourceName.localeCompare(b.sourceName, "es"),
        ),
      }];
    })
    .sort((a, b) => {
      const byCategory = a.category.localeCompare(b.category, "es");
      return byCategory || a.itemName.localeCompare(b.itemName, "es");
    });

  const recipesWithCost = recipes.map((recipe) => {
    const missingCost = recipe.effectiveComponents.some(
      (component) => component.unitCost == null,
    );
    const expandedCost = recipe.effectiveComponents.reduce(
      (sum, component) =>
        sum + component.quantity * (component.unitCost ?? 0),
      0,
    );

    return {
      ...recipe,
      expandedCost: missingCost ? null : expandedCost,
      contribution:
        recipe.salePrice != null && recipe.loyverseCost != null
          ? recipe.salePrice - recipe.loyverseCost
          : null,
      contributionPct:
        recipe.salePrice != null &&
        recipe.salePrice > 0 &&
        recipe.loyverseCost != null
          ? ((recipe.salePrice - recipe.loyverseCost) /
              recipe.salePrice) *
            100
          : null,
    };
  });

  return {
    recipes: recipesWithCost,
    totalDirectComponents: recipesWithCost.reduce(
      (sum, recipe) => sum + recipe.directComponents.length,
      0,
    ),
    totalEffectiveComponents: recipesWithCost.reduce(
      (sum, recipe) => sum + recipe.effectiveComponents.length,
      0,
    ),
    categories: [...new Set(recipesWithCost.map((recipe) => recipe.category))].sort(
      (a, b) => a.localeCompare(b, "es"),
    ),
  };
}
