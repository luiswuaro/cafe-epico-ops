import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryItems,
  recipeComponents,
  recipes,
  recipeVersions,
} from "@/src/infrastructure/db/schema";

export async function listRecipesForAdmin(organizationId: string) {
  const db = getDb();

  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      isActive: recipes.isActive,
      currentVersionId: recipes.currentVersionId,
      majorVersion: recipeVersions.majorVersion,
      minorVersion: recipeVersions.minorVersion,
      status: recipeVersions.status,
    })
    .from(recipes)
    .leftJoin(
      recipeVersions,
      eq(recipeVersions.id, recipes.currentVersionId),
    )
    .where(eq(recipes.organizationId, organizationId))
    .orderBy(asc(recipes.name));

  const drafts = await db
    .select({
      id: recipeVersions.id,
      recipeId: recipeVersions.recipeId,
      majorVersion: recipeVersions.majorVersion,
      minorVersion: recipeVersions.minorVersion,
      updatedAt: recipeVersions.updatedAt,
    })
    .from(recipeVersions)
    .where(
      and(
        eq(recipeVersions.organizationId, organizationId),
        eq(recipeVersions.status, "DRAFT"),
      ),
    )
    .orderBy(desc(recipeVersions.updatedAt));

  const latestDraftByRecipe = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (!latestDraftByRecipe.has(draft.recipeId)) {
      latestDraftByRecipe.set(draft.recipeId, draft);
    }
  }

  return rows.map((row) => ({
    ...row,
    draft: latestDraftByRecipe.get(row.id) ?? null,
  }));
}

export async function getRecipeAdminDetail(
  organizationId: string,
  recipeId: string,
  requestedVersionId?: string,
) {
  const db = getDb();

  const [recipe] = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      isActive: recipes.isActive,
      currentVersionId: recipes.currentVersionId,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.id, recipeId),
        eq(recipes.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!recipe) return null;

  const versions = await db
    .select({
      id: recipeVersions.id,
      majorVersion: recipeVersions.majorVersion,
      minorVersion: recipeVersions.minorVersion,
      status: recipeVersions.status,
      yieldQuantity: recipeVersions.yieldQuantity,
      yieldUnit: recipeVersions.yieldUnit,
      instructions: recipeVersions.instructions,
      presentationSpec: recipeVersions.presentationSpec,
      qualitySpec: recipeVersions.qualitySpec,
      publishedAt: recipeVersions.publishedAt,
      updatedAt: recipeVersions.updatedAt,
    })
    .from(recipeVersions)
    .where(
      and(
        eq(recipeVersions.recipeId, recipeId),
        eq(recipeVersions.organizationId, organizationId),
      ),
    )
    .orderBy(
      desc(recipeVersions.majorVersion),
      desc(recipeVersions.minorVersion),
    );

  const selected =
    versions.find((version) => version.id === requestedVersionId) ??
    versions.find((version) => version.status === "DRAFT") ??
    versions.find((version) => version.id === recipe.currentVersionId) ??
    versions[0];

  if (!selected) return { recipe, versions, selected: null, components: [], inventoryItems: [] };

  const [components, items] = await Promise.all([
    db
      .select({
        id: recipeComponents.id,
        inventoryItemId: recipeComponents.inventoryItemId,
        itemName: inventoryItems.name,
        unit: inventoryItems.canonicalUnit,
        quantity: recipeComponents.quantity,
        wasteFactor: recipeComponents.wasteFactor,
        sequence: recipeComponents.sequence,
        notes: recipeComponents.notes,
      })
      .from(recipeComponents)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, recipeComponents.inventoryItemId),
      )
      .where(
        and(
          eq(recipeComponents.organizationId, organizationId),
          eq(recipeComponents.recipeVersionId, selected.id),
        ),
      )
      .orderBy(asc(recipeComponents.sequence), asc(inventoryItems.name)),
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        unit: inventoryItems.canonicalUnit,
        category: inventoryItems.category,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, organizationId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .orderBy(asc(inventoryItems.category), asc(inventoryItems.name)),
  ]);

  return { recipe, versions, selected, components, inventoryItems: items };
}
