"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {getNativeRecipeOptions} from "@/src/application/pos/native-recipe-options";
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
  // Consultar catálogo antes de iniciar la transacción; no abrir otra conexión
  // dentro de una transacción que mantiene un bloqueo de escritura.
  const baseProduct = !catalogId.startsWith("manual:")
    ? (await (await import("@/src/application/pos/catalog")).getPosCatalog(
        employee.organizationId,{includeDisabled:true},
      )).find(item=>item.id===catalogId && item.sourceType==="LOYVERSE")
    : null;
  if (!catalogId.startsWith("manual:") && !baseProduct)
    throw new Error("Producto de Loyverse no encontrado.");

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
      const [existing] = await tx.select().from(posCatalogOverrides).where(and(
        eq(posCatalogOverrides.organizationId,employee.organizationId),
        eq(posCatalogOverrides.sourceExternalId,catalogId),
      )).for("update").limit(1);
      oldPrice=existing?.displayPrice!=null?Number(existing.displayPrice):baseProduct!.price;
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
  inventoryItemId:z.string().uuid().nullable().optional(),
  inventoryLocationId:z.string().uuid().nullable().optional(),
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

async function validateNativeRecipes(
  organizationId:string,storeId:string,
  dineIn:ReturnType<typeof parseRecipeJson>,
  takeaway:ReturnType<typeof parseRecipeJson>,
) {
  const {options}=await getNativeRecipeOptions(organizationId,storeId);
  const byKey=new Map(options.map(o=>[o.inventoryItemId+"|"+o.locationId,o]));
  const canonical=(recipe:ReturnType<typeof parseRecipeJson>)=>({
    components:recipe.components.map(c=>{
      if(!c.inventoryItemId&&!c.inventoryLocationId)return c;
      if(!c.inventoryItemId||!c.inventoryLocationId)
        throw new Error("Insumo OPS requiere identidad y ubicación completas.");
      const item=byKey.get(c.inventoryItemId+"|"+c.inventoryLocationId);
      if(!item)throw new Error("El insumo OPS no está activo en esta sucursal.");
      if(item.unit==="pz"&&!Number.isInteger(c.quantity))
        throw new Error("Los insumos en piezas requieren cantidades enteras: "+item.name);
      if(Math.round(c.quantity*1000)/1000!==c.quantity)
        throw new Error("Usa máximo tres decimales en "+item.name);
      return {...c,inventoryItemId:item.inventoryItemId,
        inventoryLocationId:item.locationId,
        variantExternalId:null,itemExternalId:null,
        name:item.name,unitLabel:item.unit,category:"OPS"};
    }),
  });
  return {dineIn:canonical(dineIn),takeaway:canonical(takeaway)};
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
  const draftDineIn=parseRecipeJson(formData,"dineInRecipeJson");
  const draftTakeaway=parseRecipeJson(formData,"takeawayRecipeJson");
  if(!employee.homeStoreId)throw new Error("No hay sucursal para validar inventario OPS.");
  // Preview shares production DB: never let a preview change live recipes.
  if(process.env.VERCEL_ENV==="preview")
    throw new Error("Preview de recetas en modo lectura. La edición se habilita al publicar.");
  const {dineIn,takeaway}=await validateNativeRecipes(employee.organizationId,employee.homeStoreId,draftDineIn,draftTakeaway);
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
  const draftDineIn=parseRecipeJson(formData,"dineInRecipeJson");
  const draftTakeaway=parseRecipeJson(formData,"takeawayRecipeJson");
  if(!employee.homeStoreId)throw new Error("No hay sucursal para validar inventario OPS.");
  if(process.env.VERCEL_ENV==="preview")
    throw new Error("Preview de catálogo en modo lectura para proteger el POS de producción.");
  const {dineIn,takeaway}=await validateNativeRecipes(employee.organizationId,employee.homeStoreId,draftDineIn,draftTakeaway);

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
