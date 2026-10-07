"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  inventoryItems,
  recipeComponents,
  recipes,
  recipeVersions,
} from "@/src/infrastructure/db/schema";

async function getDraft(
  organizationId: string,
  recipeId: string,
  versionId: string,
) {
  const [draft] = await getDb()
    .select()
    .from(recipeVersions)
    .where(
      and(
        eq(recipeVersions.id, versionId),
        eq(recipeVersions.recipeId, recipeId),
        eq(recipeVersions.organizationId, organizationId),
        eq(recipeVersions.status, "DRAFT"),
      ),
    )
    .limit(1);

  return draft ?? null;
}

export async function createRecipe(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 150) {
    redirect("/admin/recipes?error=name");
  }

  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({
        organizationId,
        name,
        isActive: true,
      })
      .returning({ id: recipes.id });

    const [version] = await tx
      .insert(recipeVersions)
      .values({
        organizationId,
        recipeId: recipe.id,
        majorVersion: 1,
        minorVersion: 0,
        status: "DRAFT",
        instructions: "Pendiente de documentar.",
        presentationSpec: {},
        qualitySpec: {},
        createdBy: user.id,
      })
      .returning({ id: recipeVersions.id });

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "RECIPE_CREATED",
      entityType: "recipe",
      entityId: recipe.id,
      afterData: { name, draftVersionId: version.id },
    });

    return { recipeId: recipe.id, versionId: version.id };
  });

  redirect(
    `/admin/recipes/${created.recipeId}?version=${created.versionId}`,
  );
}

export async function createRecipeDraft(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const db = getDb();

  const existingDraft = await db
    .select({ id: recipeVersions.id })
    .from(recipeVersions)
    .where(
      and(
        eq(recipeVersions.recipeId, recipeId),
        eq(recipeVersions.organizationId, organizationId),
        eq(recipeVersions.status, "DRAFT"),
      ),
    )
    .orderBy(desc(recipeVersions.updatedAt))
    .limit(1);

  if (existingDraft[0]) {
    redirect(
      `/admin/recipes/${recipeId}?version=${existingDraft[0].id}`,
    );
  }

  const [recipe] = await db
    .select({
      id: recipes.id,
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

  if (!recipe?.currentVersionId) {
    redirect("/admin/recipes?error=no-active-version");
  }

  const [current] = await db
    .select()
    .from(recipeVersions)
    .where(eq(recipeVersions.id, recipe.currentVersionId))
    .limit(1);

  if (!current) redirect("/admin/recipes?error=no-active-version");

  const allVersions = await db
    .select({
      majorVersion: recipeVersions.majorVersion,
      minorVersion: recipeVersions.minorVersion,
    })
    .from(recipeVersions)
    .where(eq(recipeVersions.recipeId, recipeId));

  const nextMinor =
    Math.max(
      ...allVersions
        .filter((version) => version.majorVersion === current.majorVersion)
        .map((version) => version.minorVersion),
      current.minorVersion,
    ) + 1;

  const sourceComponents = await db
    .select()
    .from(recipeComponents)
    .where(
      eq(recipeComponents.recipeVersionId, current.id),
    );

  const draftId = await db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(recipeVersions)
      .values({
        organizationId,
        recipeId,
        majorVersion: current.majorVersion,
        minorVersion: nextMinor,
        status: "DRAFT",
        yieldQuantity: current.yieldQuantity,
        yieldUnit: current.yieldUnit,
        instructions: current.instructions,
        presentationSpec: current.presentationSpec,
        qualitySpec: current.qualitySpec,
        referenceImagePath: current.referenceImagePath,
        createdBy: user.id,
      })
      .returning({ id: recipeVersions.id });

    if (sourceComponents.length > 0) {
      await tx.insert(recipeComponents).values(
        sourceComponents.map((component) => ({
          organizationId,
          recipeVersionId: draft.id,
          inventoryItemId: component.inventoryItemId,
          quantity: component.quantity,
          wasteFactor: component.wasteFactor,
          sequence: component.sequence,
          notes: component.notes,
        })),
      );
    }

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "RECIPE_DRAFT_CREATED",
      entityType: "recipe_version",
      entityId: draft.id,
      afterData: {
        recipeId,
        sourceVersionId: current.id,
        majorVersion: current.majorVersion,
        minorVersion: nextMinor,
      },
    });

    return draft.id;
  });

  redirect(`/admin/recipes/${recipeId}?version=${draftId}`);
}

const componentSchema = z.object({
  recipeId: z.string().uuid(),
  versionId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(1_000_000),
  wastePercent: z.coerce.number().min(0).max(100),
  sequence: z.coerce.number().int().min(0).max(10000),
  notes: z.string().trim().max(500).optional(),
});

export async function addRecipeComponent(formData: FormData) {
  const parsed = componentSchema.safeParse({
    recipeId: String(formData.get("recipeId") ?? ""),
    versionId: String(formData.get("versionId") ?? ""),
    inventoryItemId: String(formData.get("inventoryItemId") ?? ""),
    quantity: formData.get("quantity"),
    wastePercent: formData.get("wastePercent") ?? 0,
    sequence: formData.get("sequence") ?? 0,
    notes: String(formData.get("notes") ?? "") || undefined,
  });

  if (!parsed.success) throw new Error("Componente inválido");

  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const draft = await getDraft(
    organizationId,
    parsed.data.recipeId,
    parsed.data.versionId,
  );
  if (!draft) throw new Error("Solo se editan versiones DRAFT");

  const db = getDb();
  const [item] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, parsed.data.inventoryItemId),
        eq(inventoryItems.organizationId, organizationId),
        eq(inventoryItems.isActive, true),
      ),
    )
    .limit(1);
  if (!item) throw new Error("Insumo inválido");

  const [existing] = await db
    .select({ id: recipeComponents.id })
    .from(recipeComponents)
    .where(
      and(
        eq(recipeComponents.recipeVersionId, draft.id),
        eq(recipeComponents.inventoryItemId, item.id),
      ),
    )
    .limit(1);
  if (existing) throw new Error("Ese insumo ya está en la receta");

  const [created] = await db
    .insert(recipeComponents)
    .values({
      organizationId,
      recipeVersionId: draft.id,
      inventoryItemId: item.id,
      quantity: String(parsed.data.quantity),
      wasteFactor: String(parsed.data.wastePercent / 100),
      sequence: parsed.data.sequence,
      notes: parsed.data.notes ?? null,
    })
    .returning({ id: recipeComponents.id });

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "RECIPE_COMPONENT_ADDED",
    entityType: "recipe_component",
    entityId: created.id,
    afterData: parsed.data,
  });

  revalidatePath(`/admin/recipes/${parsed.data.recipeId}`);
}

export async function updateRecipeComponent(formData: FormData) {
  const componentId = String(formData.get("componentId") ?? "");
  const recipeId = String(formData.get("recipeId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const quantity = Number(formData.get("quantity"));
  const wastePercent = Number(formData.get("wastePercent") ?? 0);
  const sequence = Number(formData.get("sequence") ?? 0);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (
    !componentId ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(wastePercent) ||
    wastePercent < 0 ||
    wastePercent > 100 ||
    !Number.isInteger(sequence)
  ) {
    throw new Error("Componente inválido");
  }

  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const draft = await getDraft(organizationId, recipeId, versionId);
  if (!draft) throw new Error("Solo se editan versiones DRAFT");

  const db = getDb();
  const [before] = await db
    .select()
    .from(recipeComponents)
    .where(
      and(
        eq(recipeComponents.id, componentId),
        eq(recipeComponents.organizationId, organizationId),
        eq(recipeComponents.recipeVersionId, versionId),
      ),
    )
    .limit(1);

  if (!before) throw new Error("Componente no encontrado");

  await db
    .update(recipeComponents)
    .set({
      quantity: String(quantity),
      wasteFactor: String(wastePercent / 100),
      sequence,
      notes,
    })
    .where(eq(recipeComponents.id, componentId));

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "RECIPE_COMPONENT_UPDATED",
    entityType: "recipe_component",
    entityId: componentId,
    beforeData: {
      quantity: before.quantity,
      wasteFactor: before.wasteFactor,
      sequence: before.sequence,
      notes: before.notes,
    },
    afterData: { quantity, wastePercent, sequence, notes },
  });

  revalidatePath(`/admin/recipes/${recipeId}`);
}

export async function removeRecipeComponent(formData: FormData) {
  const componentId = String(formData.get("componentId") ?? "");
  const recipeId = String(formData.get("recipeId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");

  const draft = await getDraft(organizationId, recipeId, versionId);
  if (!draft) throw new Error("Solo se editan versiones DRAFT");

  const db = getDb();
  const [before] = await db
    .select()
    .from(recipeComponents)
    .where(
      and(
        eq(recipeComponents.id, componentId),
        eq(recipeComponents.organizationId, organizationId),
        eq(recipeComponents.recipeVersionId, versionId),
      ),
    )
    .limit(1);

  if (!before) return;

  await db
    .delete(recipeComponents)
    .where(eq(recipeComponents.id, componentId));

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "RECIPE_COMPONENT_REMOVED",
    entityType: "recipe_component",
    entityId: componentId,
    beforeData: {
      inventoryItemId: before.inventoryItemId,
      quantity: before.quantity,
      wasteFactor: before.wasteFactor,
    },
  });

  revalidatePath(`/admin/recipes/${recipeId}`);
}

export async function updateRecipeDraft(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const instructions =
    String(formData.get("instructions") ?? "").trim();
  const yieldQuantityRaw =
    String(formData.get("yieldQuantity") ?? "").trim();
  const yieldUnitRaw =
    String(formData.get("yieldUnit") ?? "").trim();
  const qualitySpecRaw =
    String(formData.get("qualitySpec") ?? "{}").trim() || "{}";

  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const draft = await getDraft(organizationId, recipeId, versionId);
  if (!draft) throw new Error("Solo se editan versiones DRAFT");

  let qualitySpec: Record<string, unknown>;
  try {
    const parsed = JSON.parse(qualitySpecRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    qualitySpec = parsed as Record<string, unknown>;
  } catch {
    throw new Error("qualitySpec debe ser JSON válido");
  }

  const yieldQuantity = yieldQuantityRaw
    ? Number(yieldQuantityRaw)
    : null;
  if (
    yieldQuantity != null &&
    (!Number.isFinite(yieldQuantity) || yieldQuantity < 0)
  ) {
    throw new Error("Rendimiento inválido");
  }
  const yieldUnit =
    yieldUnitRaw === "g" ||
    yieldUnitRaw === "ml" ||
    yieldUnitRaw === "pz"
      ? yieldUnitRaw
      : null;

  await getDb()
    .update(recipeVersions)
    .set({
      instructions: instructions || "Pendiente de documentar.",
      yieldQuantity:
        yieldQuantity == null ? null : String(yieldQuantity),
      yieldUnit,
      qualitySpec,
      updatedAt: new Date(),
    })
    .where(eq(recipeVersions.id, draft.id));

  await getDb().insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "RECIPE_DRAFT_UPDATED",
    entityType: "recipe_version",
    entityId: draft.id,
    afterData: { yieldQuantity, yieldUnit, qualitySpec },
  });

  revalidatePath(`/admin/recipes/${recipeId}`);
}

export async function publishRecipeDraft(formData: FormData) {
  const recipeId = String(formData.get("recipeId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const { employeeId, user, organizationId } =
    await requirePermission("recipe.manage");
  const db = getDb();

  const draft = await getDraft(organizationId, recipeId, versionId);
  if (!draft) throw new Error("Solo se publica una versión DRAFT");

  const [recipe] = await db
    .select({
      id: recipes.id,
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
  if (!recipe) throw new Error("Receta no encontrada");

  const now = new Date();
  await db.transaction(async (tx) => {
    if (recipe.currentVersionId) {
      await tx
        .update(recipeVersions)
        .set({
          status: "ARCHIVED",
          effectiveUntil: now,
          updatedAt: now,
        })
        .where(eq(recipeVersions.id, recipe.currentVersionId));
    }

    await tx
      .update(recipeVersions)
      .set({
        status: "ACTIVE",
        effectiveFrom: now,
        publishedAt: now,
        approvedBy: user.id,
        updatedAt: now,
      })
      .where(eq(recipeVersions.id, draft.id));

    await tx
      .update(recipes)
      .set({
        currentVersionId: draft.id,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(recipes.id, recipe.id));

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "RECIPE_VERSION_PUBLISHED",
      entityType: "recipe_version",
      entityId: draft.id,
      beforeData: { currentVersionId: recipe.currentVersionId },
      afterData: {
        currentVersionId: draft.id,
        majorVersion: draft.majorVersion,
        minorVersion: draft.minorVersion,
      },
    });
  });

  revalidatePath("/recipes");
  revalidatePath("/admin/recipes");
  revalidatePath(`/admin/recipes/${recipeId}`);
  redirect(`/admin/recipes/${recipeId}`);
}
