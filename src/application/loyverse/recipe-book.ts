import { getLoyverseRecipeSource } from "@/src/application/loyverse/recipes";
import {
  operationalRecipeCategory,
  operationalRecipeCategoryOrder,
  operationalRecipeKey,
  normalizeOperationalRecipeName,
  type OperationalRecipeCategory,
} from "@/src/domain/recipes/operational";

type SourceRecipe = Awaited<
  ReturnType<typeof getLoyverseRecipeSource>
>["recipes"][number];
type EffectiveComponent = SourceRecipe["effectiveComponents"][number];
type DirectComponent = SourceRecipe["directComponents"][number];

type OperationalCandidate = {
  category: OperationalRecipeCategory;
  recipe: SourceRecipe;
};

const DISPOSABLE_PATTERN =
  /(VASO|TAPA|POPOTE|MANGA|FAJILLA|SERVILLETA|BOLSA|CUBIERTO|CHAROLA|PORTAVASOS|DOMO)/i;

const SERVICE_PACKAGING: Record<
  "DINE_IN" | "TAKEAWAY",
  Record<Exclude<OperationalRecipeCategory, "ALIMENTOS">, string[]>
> = {
  DINE_IN: {
    CALIENTES: [],
    "FRÍAS": ["POPOTE PARA TAPIOCA"],
  },
  TAKEAWAY: {
    CALIENTES: [
      "VASO CALIENTE 12OZ",
      "TAPA CALIENTE 12OZ",
      "MANGA DE PAPEL",
    ],
    "FRÍAS": [
      "VASO FRIO 16OZ",
      "TAPA PLANA16 OZ",
      "POPOTE PARA TAPIOCA",
    ],
  },
};

function normalize(value: string) {
  return normalizeOperationalRecipeName(value).replace(/\s+/g, " ").trim();
}

function isDisposableName(value: string) {
  return DISPOSABLE_PATTERN.test(normalize(value));
}

function preference(category: string, disposableCount: number) {
  const upper = normalize(category);
  if (upper.includes("AQUI")) return 0;
  if (!upper.includes("P/LL") && !upper.includes("LLEVAR")) return 1;
  return 10 + disposableCount;
}

function candidateScore(candidate: OperationalCandidate) {
  const disposableCount = candidate.recipe.directComponents.filter(
    (row) => row.isDisposable,
  ).length;
  const operationalComponents = candidate.recipe.directComponents.filter(
    (row) => !row.isDisposable,
  ).length;

  return {
    sourcePreference: preference(
      candidate.recipe.category,
      disposableCount,
    ),
    disposableCount,
    operationalComponents,
  };
}

function mergeEffective(
  components: EffectiveComponent[],
): EffectiveComponent[] {
  const merged = new Map<string, EffectiveComponent>();

  for (const component of components) {
    const key =
      component.variantExternalId ||
      normalize(component.sourceName);
    const current = merged.get(key);

    if (current) {
      current.quantity += component.quantity;
    } else {
      merged.set(key, { ...component });
    }
  }

  return [...merged.values()].sort((a, b) =>
    a.sourceName.localeCompare(b.sourceName, "es"),
  );
}

function mergeDirect(components: DirectComponent[]): DirectComponent[] {
  const merged = new Map<string, DirectComponent>();

  for (const component of components) {
    const key =
      component.variantExternalId ||
      normalize(component.sourceName);
    const current = merged.get(key);

    if (current) {
      current.quantity += component.quantity;
      current.displayQuantity += component.displayQuantity;
    } else {
      merged.set(key, { ...component });
    }
  }

  return [...merged.values()].sort((a, b) =>
    a.sourceName.localeCompare(b.sourceName, "es"),
  );
}

export async function getOperationalRecipeSource(
  organizationId: string,
) {
  const source = await getLoyverseRecipeSource(organizationId);
  const groups = new Map<string, OperationalCandidate[]>();

  for (const recipe of source.recipes) {
    if (!recipe.availableForSale) continue;

    const category = operationalRecipeCategory(recipe.category);
    if (!category) continue;

    const key = operationalRecipeKey(recipe.itemName, category);
    const list = groups.get(key) ?? [];
    list.push({ category, recipe });
    groups.set(key, list);
  }

  const allEffective = source.recipes.flatMap(
    (recipe) => recipe.effectiveComponents,
  );
  const effectiveByName = new Map<string, EffectiveComponent>();
  for (const component of allEffective) {
    const key = normalize(component.sourceName);
    if (!effectiveByName.has(key)) {
      effectiveByName.set(key, component);
    }
  }

  function standardEffectivePackaging(names: string[]) {
    const missing: string[] = [];
    const components = names.flatMap((name) => {
      const component = effectiveByName.get(normalize(name));
      if (!component) {
        missing.push(name);
        return [];
      }
      return [{ ...component, quantity: 1 }];
    });
    return { components, missing };
  }

  const recipes = [...groups.values()]
    .map((candidates) => {
      const sortedCandidates = [...candidates].sort((a, b) => {
        const aScore = candidateScore(a);
        const bScore = candidateScore(b);

        return (
          aScore.sourcePreference - bScore.sourcePreference ||
          aScore.disposableCount - bScore.disposableCount ||
          bScore.operationalComponents - aScore.operationalComponents ||
          a.recipe.itemName.localeCompare(b.recipe.itemName, "es") ||
          a.recipe.externalId.localeCompare(b.recipe.externalId)
        );
      });

      const selected = sortedCandidates[0];
      const category = selected.category;
      const baseDirect = selected.recipe.directComponents.filter(
        (component) => !component.isDisposable,
      );
      const baseEffective = selected.recipe.effectiveComponents.filter(
        (component) => !isDisposableName(component.sourceName),
      );

      let directComponents = mergeDirect(baseDirect);
      let dineInComponents = mergeEffective(baseEffective);
      let takeawayComponents = mergeEffective(baseEffective);
      const packagingWarnings: string[] = [];

      if (category === "CALIENTES" || category === "FRÍAS") {
        const dineInPackaging = standardEffectivePackaging(
          SERVICE_PACKAGING.DINE_IN[category],
        );
        const takeawayPackaging = standardEffectivePackaging(
          SERVICE_PACKAGING.TAKEAWAY[category],
        );

        directComponents = mergeDirect(baseDirect);
        dineInComponents = mergeEffective([
          ...baseEffective,
          ...dineInPackaging.components,
        ]);
        takeawayComponents = mergeEffective([
          ...baseEffective,
          ...takeawayPackaging.components,
        ]);

        packagingWarnings.push(
          ...dineInPackaging.missing,
          ...takeawayPackaging.missing,
        );
      } else {
        const takeawayCandidate =
          candidates.find((candidate) => {
            const sourceCategory = normalize(candidate.recipe.category);
            return (
              sourceCategory.includes("P/LL") ||
              sourceCategory.includes("LLEVAR")
            );
          }) ?? selected;

        const foodTakeawayDisposables =
          takeawayCandidate.recipe.effectiveComponents.filter(
            (component) => isDisposableName(component.sourceName),
          );

        takeawayComponents = mergeEffective([
          ...baseEffective,
          ...foodTakeawayDisposables,
        ]);

        if (foodTakeawayDisposables.length === 0) {
          packagingWarnings.push(
            "Empaque para llevar de alimento pendiente de configurar",
          );
        }
      }

      return {
        ...selected.recipe,
        sourceCategory: selected.recipe.category,
        category,
        directComponents,
        effectiveComponents: dineInComponents,
        packagingWarnings,
        serviceRecipes: {
          DINE_IN: {
            externalId: selected.recipe.externalId,
            variantExternalId: selected.recipe.variantExternalId,
            sourceCategory: selected.recipe.category,
            effectiveComponents: dineInComponents,
          },
          TAKEAWAY: {
            externalId: selected.recipe.externalId,
            variantExternalId: selected.recipe.variantExternalId,
            sourceCategory: selected.recipe.category,
            effectiveComponents: takeawayComponents,
          },
        },
      };
    })
    .sort((a, b) => {
      const byCategory =
        operationalRecipeCategoryOrder(a.category) -
        operationalRecipeCategoryOrder(b.category);
      return byCategory || a.itemName.localeCompare(b.itemName, "es");
    });

  return {
    recipes,
    totalDirectComponents: recipes.reduce(
      (sum, recipe) => sum + recipe.directComponents.length,
      0,
    ),
    totalEffectiveComponents: recipes.reduce(
      (sum, recipe) => sum + recipe.effectiveComponents.length,
      0,
    ),
    packagingWarnings: recipes.flatMap((recipe) =>
      recipe.packagingWarnings.map((warning) => ({
        recipe: recipe.itemName,
        category: recipe.category,
        warning,
      })),
    ),
    categories: ["CALIENTES", "FRÍAS", "ALIMENTOS"] as const,
  };
}

export async function getEmployeeRecipeBook(organizationId: string) {
  const source = await getOperationalRecipeSource(organizationId);

  return source.recipes.map((recipe) => ({
    key: operationalRecipeKey(recipe.itemName, recipe.category),
    id: recipe.externalId,
    name: recipe.itemName,
    category: recipe.category,
    components: recipe.directComponents.filter(
      (component) => !component.isDisposable,
    ),
  }));
}

export async function getEmployeeRecipe(
  organizationId: string,
  externalId: string,
) {
  const book = await getEmployeeRecipeBook(organizationId);
  return book.find((recipe) => recipe.id === externalId) ?? null;
}
