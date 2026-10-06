import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { inventoryItems, recipeComponents, recipes, recipeVersions } from "@/src/infrastructure/db/schema";

export async function listActiveRecipes(organizationId: string) {
  return getDb().select({ id: recipes.id, name: recipes.name, versionId: recipeVersions.id, majorVersion: recipeVersions.majorVersion, minorVersion: recipeVersions.minorVersion, yieldQuantity: recipeVersions.yieldQuantity, yieldUnit: recipeVersions.yieldUnit })
    .from(recipes).innerJoin(recipeVersions, eq(recipeVersions.id, recipes.currentVersionId))
    .where(and(eq(recipes.organizationId, organizationId), eq(recipes.isActive, true)));
}

export async function getActiveRecipe(organizationId: string, recipeId: string) {
  const db = getDb();
  const [recipe] = await db.select({ id: recipes.id, name: recipes.name, versionId: recipeVersions.id, majorVersion: recipeVersions.majorVersion, minorVersion: recipeVersions.minorVersion, instructions: recipeVersions.instructions, presentationSpec: recipeVersions.presentationSpec, qualitySpec: recipeVersions.qualitySpec, yieldQuantity: recipeVersions.yieldQuantity, yieldUnit: recipeVersions.yieldUnit })
    .from(recipes).innerJoin(recipeVersions, eq(recipeVersions.id, recipes.currentVersionId))
    .where(and(eq(recipes.organizationId, organizationId), eq(recipes.id, recipeId))).limit(1);
  if (!recipe) return null;
  const components = await db.select({ itemName: inventoryItems.name, quantity: recipeComponents.quantity, unit: inventoryItems.canonicalUnit, wasteFactor: recipeComponents.wasteFactor, notes: recipeComponents.notes })
    .from(recipeComponents).innerJoin(inventoryItems, eq(inventoryItems.id, recipeComponents.inventoryItemId))
    .where(and(eq(recipeComponents.organizationId, organizationId), eq(recipeComponents.recipeVersionId, recipe.versionId)));
  return { ...recipe, components };
}
