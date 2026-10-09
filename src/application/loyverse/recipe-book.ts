import { getLoyverseRecipeSource } from "@/src/application/loyverse/recipes";
import {
  operationalRecipeCategory,
  operationalRecipeCategoryOrder,
  operationalRecipeKey,
  type OperationalRecipeCategory,
} from "@/src/domain/recipes/operational";

type SourceRecipe = Awaited<
  ReturnType<typeof getLoyverseRecipeSource>
>["recipes"][number];

type OperationalCandidate = {
  category: OperationalRecipeCategory;
  recipe: SourceRecipe;
};

function preference(category: string, disposableCount: number) {
  const upper = category.toUpperCase();
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

function disposableName(name: string) {
  return /VASO|TAPA|MANGA|FAJILLA|SERVILLETA|POPOTE|BOLSA|CUBIERTO|CHAROLA/i.test(name);
}
function strawName(name: string) {
  return /POPOTE|PAJILLA/i.test(name);
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
      const dineIn =
        candidates.find((candidate) =>
          candidate.recipe.category.toUpperCase().includes("AQUI"),
        ) ?? selected;
      const takeaway =
        candidates.find((candidate) => {
          const sourceCategory = candidate.recipe.category.toUpperCase();
          return (
            sourceCategory.includes("P/LL") ||
            sourceCategory.includes("LLEVAR")
          );
        }) ?? selected;

      // Incluso cuando Loyverse sólo tiene receta para llevar,
      // el servicio aquí usa vajilla reutilizable. En bebidas frías sí va popote.
      const dineInComponents = dineIn.recipe.effectiveComponents.filter(
        (component) =>
          !disposableName(component.sourceName) ||
          (selected.category === "FRÍAS" && strawName(component.sourceName)),
      );
      if (selected.category === "FRÍAS" &&
          !dineInComponents.some((component) => strawName(component.sourceName))) {
        const straw = takeaway.recipe.effectiveComponents.find(
          (component) => strawName(component.sourceName),
        );
        if (straw) dineInComponents.push(straw);
      }

      return {
        ...selected.recipe,
        sourceCategory: selected.recipe.category,
        category: selected.category,
        serviceRecipes: {
          DINE_IN: {
            externalId: dineIn.recipe.externalId,
            variantExternalId: dineIn.recipe.variantExternalId,
            sourceCategory: dineIn.recipe.category,
            effectiveComponents: dineInComponents,
          },
          TAKEAWAY: {
            externalId: takeaway.recipe.externalId,
            variantExternalId: takeaway.recipe.variantExternalId,
            sourceCategory: takeaway.recipe.category,
            effectiveComponents: takeaway.recipe.effectiveComponents,
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
