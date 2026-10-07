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

export async function getEmployeeRecipeBook(organizationId: string) {
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
      const selected = [...candidates].sort((a, b) => {
        const aScore = candidateScore(a);
        const bScore = candidateScore(b);

        return (
          aScore.sourcePreference - bScore.sourcePreference ||
          aScore.disposableCount - bScore.disposableCount ||
          bScore.operationalComponents - aScore.operationalComponents ||
          a.recipe.itemName.localeCompare(b.recipe.itemName, "es") ||
          a.recipe.externalId.localeCompare(b.recipe.externalId)
        );
      })[0];

      return {
        key: operationalRecipeKey(
          selected.recipe.itemName,
          selected.category,
        ),
        id: selected.recipe.externalId,
        name: selected.recipe.itemName,
        category: selected.category,
        components: selected.recipe.directComponents.filter(
          (component) => !component.isDisposable,
        ),
      };
    })
    .sort((a, b) => {
      const byCategory =
        operationalRecipeCategoryOrder(a.category) -
        operationalRecipeCategoryOrder(b.category);
      return byCategory || a.name.localeCompare(b.name, "es");
    });

  return recipes;
}

export async function getEmployeeRecipe(
  organizationId: string,
  externalId: string,
) {
  const book = await getEmployeeRecipeBook(organizationId);
  return book.find((recipe) => recipe.id === externalId) ?? null;
}
