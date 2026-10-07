import { getOperationalRecipeSource } from "@/src/application/loyverse/recipe-book";

export type PosServiceMode = "DINE_IN" | "TAKEAWAY";

export async function getPosCatalog(organizationId: string) {
  const source = await getOperationalRecipeSource(organizationId);

  return source.recipes
    .filter((recipe) => recipe.salePrice != null && recipe.salePrice > 0)
    .map((recipe) => ({
      id: recipe.externalId,
      variantExternalId: recipe.variantExternalId,
      name: recipe.itemName,
      category: recipe.category,
      price: Number(recipe.salePrice),
      serviceRecipes: recipe.serviceRecipes,
    }));
}
