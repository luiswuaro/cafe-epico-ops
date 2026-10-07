"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCatalogOverrides,
  posManualProducts,
} from "@/src/infrastructure/db/schema";

const categorySchema = z.enum(["CALIENTES", "FRÍAS", "ALIMENTOS"]);

const recipeComponentSchema = z.object({
  variantExternalId: z.string().nullable().optional(),
  itemExternalId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().positive().max(100000),
  unitLabel: z.string().trim().min(1).max(40),
  category: z.string().nullable().optional(),
});

const recipeSchema = z.object({
  components: z.array(recipeComponentSchema).max(60),
});

function parseRecipeJson(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return { components: [] };
  return recipeSchema.parse(JSON.parse(raw));
}

export async function togglePosCatalogItem(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const db = getDb();

  if (catalogId.startsWith("manual:")) {
    const id = catalogId.slice("manual:".length);
    await db
      .update(posManualProducts)
      .set({ isActive: enabled, updatedAt: new Date() })
      .where(
        and(
          eq(posManualProducts.id, id),
          eq(posManualProducts.organizationId, employee.organizationId),
        ),
      );
  } else {
    await db
      .insert(posCatalogOverrides)
      .values({
        organizationId: employee.organizationId,
        sourceExternalId: catalogId,
        isEnabled: enabled,
        updatedByEmployeeId: employee.id,
      })
      .onConflictDoUpdate({
        target: [
          posCatalogOverrides.organizationId,
          posCatalogOverrides.sourceExternalId,
        ],
        set: {
          isEnabled: enabled,
          updatedByEmployeeId: employee.id,
          updatedAt: new Date(),
        },
      });
  }

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: enabled ? "POS_CATALOG_ITEM_ENABLED" : "POS_CATALOG_ITEM_DISABLED",
    entityType: "pos_catalog_item",
    entityId: catalogId,
    afterData: { enabled },
  });

  redirect("/admin/pos/catalog");
}

export async function savePosRecipe(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const dineIn = parseRecipeJson(formData, "dineInRecipeJson");
  const takeaway = parseRecipeJson(formData, "takeawayRecipeJson");
  const db = getDb();

  if (catalogId.startsWith("manual:")) {
    const id = catalogId.slice("manual:".length);
    await db
      .update(posManualProducts)
      .set({
        recipeDineIn: dineIn,
        recipeTakeaway: takeaway,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posManualProducts.id, id),
          eq(posManualProducts.organizationId, employee.organizationId),
        ),
      );
  } else {
    await db
      .insert(posCatalogOverrides)
      .values({
        organizationId: employee.organizationId,
        sourceExternalId: catalogId,
        recipeDineIn: dineIn,
        recipeTakeaway: takeaway,
        updatedByEmployeeId: employee.id,
      })
      .onConflictDoUpdate({
        target: [
          posCatalogOverrides.organizationId,
          posCatalogOverrides.sourceExternalId,
        ],
        set: {
          recipeDineIn: dineIn,
          recipeTakeaway: takeaway,
          updatedByEmployeeId: employee.id,
          updatedAt: new Date(),
        },
      });
  }

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_RECIPE_UPDATED",
    entityType: "pos_catalog_item",
    entityId: catalogId,
    afterData: {
      dineInComponents: dineIn.components.length,
      takeawayComponents: takeaway.components.length,
    },
  });

  redirect("/admin/pos/catalog?saved=" + encodeURIComponent(catalogId));
}

export async function createManualPosProduct(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id,
    "pos.catalog.manage",
    employee.homeStoreId ?? undefined,
  );

  const name = String(formData.get("name") ?? "").trim();
  const category = categorySchema.parse(
    String(formData.get("category") ?? ""),
  );
  const price = Number(formData.get("price"));
  const dineIn = parseRecipeJson(formData, "dineInRecipeJson");
  const takeaway = parseRecipeJson(formData, "takeawayRecipeJson");

  if (!name) throw new Error("Falta el nombre del producto");
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Precio inválido");
  }

  const db = getDb();
  const [created] = await db
    .insert(posManualProducts)
    .values({
      organizationId: employee.organizationId,
      name,
      category,
      price: price.toFixed(2),
      recipeDineIn: dineIn,
      recipeTakeaway: takeaway,
      createdByEmployeeId: employee.id,
    })
    .returning({ id: posManualProducts.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_MANUAL_PRODUCT_CREATED",
    entityType: "pos_manual_product",
    entityId: created.id,
    afterData: { name, category, price },
  });

  redirect("/admin/pos/catalog?saved=manual:" + created.id);
}
