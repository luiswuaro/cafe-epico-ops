export const OPERATIONAL_RECIPE_CATEGORIES = [
  "CALIENTES",
  "FRÍAS",
  "ALIMENTOS",
] as const;

export type OperationalRecipeCategory =
  (typeof OPERATIONAL_RECIPE_CATEGORIES)[number];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOperationalRecipeName(value: string) {
  return normalize(value);
}

export function operationalRecipeCategory(
  sourceCategory: string,
): OperationalRecipeCategory | null {
  const category = normalize(sourceCategory);

  if (category.includes("ALIMENTO")) return "ALIMENTOS";
  if (category.includes("FRIA")) return "FRÍAS";

  if (category.includes("CALIENTE") || category.includes("CACAO")) {
    return "CALIENTES";
  }

  return null;
}

export function operationalRecipeKey(
  name: string,
  category: OperationalRecipeCategory,
) {
  return category + "|" + normalizeOperationalRecipeName(name);
}

export function isOperationalRecipeCategory(
  value: string,
): value is OperationalRecipeCategory {
  return (OPERATIONAL_RECIPE_CATEGORIES as readonly string[]).includes(value);
}

export function operationalRecipeCategoryOrder(
  category: OperationalRecipeCategory,
) {
  return OPERATIONAL_RECIPE_CATEGORIES.indexOf(category);
}
