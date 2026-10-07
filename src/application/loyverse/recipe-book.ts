import { getLoyverseRecipeSource } from "@/src/application/loyverse/recipes";

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function preference(category: string, disposableCount: number) {
  const upper = category.toUpperCase();
  if (upper.includes("AQUI")) return 0;
  if (!upper.includes("P/LL") && !upper.includes("LLEVAR")) return 1;
  return 10 + disposableCount;
}

export async function getEmployeeRecipeBook(organizationId: string) {
  const source = await getLoyverseRecipeSource(organizationId);
  const groups = new Map<string, typeof source.recipes>();

  for (const recipe of source.recipes) {
    if (!recipe.availableForSale) continue;
    const category = recipe.category.toUpperCase();
    if (category.includes("INSUMO") || category.includes("ALIMENTO")) {
      continue;
    }

    const key = normalizeName(recipe.itemName);
    const list = groups.get(key) ?? [];
    list.push(recipe);
    groups.set(key, list);
  }

  const recipes = [...groups.entries()]
    .map(([key, candidates]) => {
      const selected = [...candidates].sort(
        (a, b) =>
          preference(
            a.category,
            a.directComponents.filter((row) => row.isDisposable).length,
          ) -
          preference(
            b.category,
            b.directComponents.filter((row) => row.isDisposable).length,
          ),
      )[0];

      return {
        key,
        id: selected.externalId,
        name: selected.itemName,
        category: selected.category,
        components: selected.directComponents.filter(
          (component) => !component.isDisposable,
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return recipes;
}

export async function getEmployeeRecipe(
  organizationId: string,
  externalId: string,
) {
  const book = await getEmployeeRecipeBook(organizationId);
  return book.find((recipe) => recipe.id === externalId) ?? null;
}
