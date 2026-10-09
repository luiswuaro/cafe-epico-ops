"use server";

import { and, eq, sql } from "drizzle-orm";
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
const priceSchema = z.number().finite().positive().max(100000).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
  "El precio debe tener como máximo dos decimales.",
);

export async function updatePosCatalogPrice(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  await assertEmployeePermission(
    employee.id, "pos.catalog.manage", employee.homeStoreId ?? undefined,
  );
  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const price = priceSchema.parse(Number(formData.get("price")));
  const db = getDb();
  const now = new Date();
  const newPrice = price.toFixed(2);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.organizationId}))`);
    let oldPrice: number;
    if (catalogId.startsWith("manual:")) {
      const productId = z.string().uuid().parse(catalogId.slice(7));
      const [product] = await tx.select().from(posManualProducts).where(and(
        eq(posManualProducts.id, productId),
        eq(posManualProducts.organizationId, employee.organizationId),
      )).for("update").limit(1);
      if (!product) throw new Error("Producto manual no encontrado.");
      oldPrice = Number(product.price);
      await tx.update(posManualProducts).set({
        price: newPrice, updatedAt: now,
      }).where(eq(posManualProducts.id, product.id));
    } else {
      if (!catalogId) throw new Error("Falta seleccionar un producto.");
      // El catálogo se valida sobre la lectura operativa, no contra datos del formulario.
      const { getPosCatalog } = await import("@/src/application/pos/catalog");
      const catalog = await getPosCatalog(employee.organizationId, {includeDisabled:true});
      const product = catalog.find(item=>item.id===catalogId && item.sourceType==="LOYVERSE");
      if (!product) throw new Error("Producto de Loyverse no encontrado.");
      oldPrice = product.price;
      await tx.insert(posCatalogOverrides).values({
        organizationId: employee.organizationId,
        sourceExternalId: catalogId,
        displayPrice: newPrice,
        updatedByEmployeeId: employee.id,
      }).onConflictDoUpdate({
        target: [posCatalogOverrides.organizationId, posCatalogOverrides.sourceExternalId],
        set: { displayPrice: newPrice, updatedByEmployeeId: employee.id, updatedAt: now },
      });
    }
    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId, storeId: employee.homeStoreId,
      actorUserId: user.id, actorEmployeeId: employee.id,
      action: "POS_CATALOG_PRICE_UPDATED",
      entityType: "pos_catalog_item", entityId: catalogId,
      beforeData: {price: oldPrice},
      afterData: {price, source: catalogId.startsWith("manual:")?"OPS":"LOYVERSE_OVERRIDE"},
    });
  });
  redirect("/admin/pos/catalog?priceSaved=" + encodeURIComponent(catalogId));
}


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
